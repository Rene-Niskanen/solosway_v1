"""
No-results node prompts: helpful failure messages when retrieval exhausts retries.

Callables:
- get_no_results_system_prompt() -> str
- get_no_results_human_prompt(...) -> str
"""


def get_no_results_system_prompt() -> str:
    """Return system prompt for generating helpful search-failure messages."""
    return """You are a helpful assistant that explains search failures to users.

When document or chunk retrieval fails after multiple retry attempts, generate a helpful
failure message that:
1. Explains what was searched (query, document types, retry attempts)
2. Asks a clarification question if the query is ambiguous
3. Suggests rephrasing based on failure reasons
4. Mentions document types found (if any) that might be relevant
5. Is friendly, helpful, and actionable

Be concise but informative. Don't be overly technical."""


def get_no_results_human_prompt(
    user_query: str,
    failure_description: str,
    failure_context: str,
    document_retry_count: int,
    chunk_retry_count: int,
    document_types_str: str,
    query_intent_search_goal: str = "unknown",
    query_intent_query_type: str = "unknown",
) -> str:
    """Build human prompt for no-results node with failure context."""
    return f"""The user asked: "{user_query}"

Search failed after retries:
{failure_description}

Failure context: {failure_context}
Document retry attempts: {document_retry_count}
Chunk retry attempts: {chunk_retry_count}
Document types found: {document_types_str}
Query intent: {query_intent_search_goal} ({query_intent_query_type} query)

Generate a helpful failure message that:
- Explains what was searched
- Suggests alternative queries or rephrasing
- Asks for clarification if needed
- Mentions any relevant document types found

Keep it concise and actionable."""


# --- Responder no-chunk branch (when executor ran but no chunks returned) ---

def get_responder_no_chunks_system_prompt() -> str:
    """System prompt for generating a single no-results message in the responder (no chunks found)."""
    return """You are a helpful assistant. The user asked a question but the search did not find any matching content.

Generate ONE short, friendly message (1-2 sentences) that:
- Acknowledges you looked
- Briefly explains nothing matched (without technical jargon)
- Suggests rephrasing or adding more detail

Stay in character: warm and helpful. No bullet points, no "Try:" lists. One natural paragraph only."""


def get_responder_no_chunks_human_prompt(
    user_query: str,
    has_documents: bool,
    refinement_limit_reached: bool,
) -> str:
    """Human prompt for responder no-chunks case."""
    context = []
    if refinement_limit_reached:
        context.append("We already tried a few different ways to find something.")
    if has_documents:
        context.append("Some documents were found but none contained content that matched the question.")
    else:
        context.append("No documents matched the search.")
    context_str = " ".join(context) if context else "The search did not find matching content."
    return f"""The user asked: "{user_query}"

{context_str}

Generate a single short, friendly reply (1-2 sentences) asking them to rephrase or give a bit more detail. No technical terms."""

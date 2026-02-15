"""
Routing node prompts: attachment-fast path and citation-query human content.

Callables:
- get_attachment_fast_system_prompt() -> str
- get_citation_query_human_prompt(filename, page_number, cited_text, user_query) -> str
"""


def get_attachment_fast_system_prompt() -> str:
    """System prompt for handle_attachment_fast (single LLM call with attachment context)."""
    return "You are a helpful assistant that answers questions based on provided document content."


def get_citation_query_human_prompt(
    filename: str,
    page_number: str,
    cited_text: str,
    user_query: str,
) -> str:
    """Human content for citation chip follow-up (answer from cited text only)."""
    return f"""You are answering a question about a specific piece of text from a document.

**CITATION CONTEXT:**
- Document: {filename}
- Page: {page_number}
- Cited text: "{cited_text}"

**USER'S QUESTION:**
{user_query}

**INSTRUCTIONS:**
1. Answer the user's question based on the cited text and your knowledge
2. If the cited text contains the answer, quote relevant parts
3. If the user is asking for more context or explanation, provide helpful information
4. If the question cannot be answered from the cited text alone, provide relevant general knowledge
5. Be concise but thorough
6. Do NOT say you need to search documents - you already have the relevant text above
7. Include [1] citation marker when referencing the cited text

Provide a direct, helpful answer:"""

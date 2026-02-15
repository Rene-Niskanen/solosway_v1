"""
Routing node prompts: attachment-fast path and citation-query human content.

Callables:
- get_attachment_fast_system_prompt() -> str
- get_citation_query_human_prompt(filename, page_number, cited_text, user_query, full_document_excerpt?) -> str
"""

from typing import Optional


def get_attachment_fast_system_prompt() -> str:
    """System prompt for handle_attachment_fast (single LLM call with attachment context)."""
    return "You are a helpful assistant that answers questions based on provided document content."


def get_citation_query_human_prompt(
    filename: str,
    page_number: str,
    cited_text: str,
    user_query: str,
    full_document_excerpt: Optional[str] = None,
) -> str:
    """Human content for citation chip follow-up. Prefer cited text; use full_document_excerpt if the answer is not there."""
    full_doc_section = ""
    if full_document_excerpt and full_document_excerpt.strip():
        full_doc_section = f"""

**FULL DOCUMENT (use if the answer is not in the cited text above):**
The following is more content from the same document. Use it to answer the user's question when the cited snippet does not contain the answer (e.g. they ask for the firm name, employer, or other details that appear elsewhere in the document).

---
{full_document_excerpt.strip()}
---
"""

    return f"""You are answering a question about a specific piece of text from a document.

**CITATION CONTEXT:**
- Document: {filename}
- Page: {page_number}
- Cited text: "{cited_text}"
{full_doc_section}

**USER'S QUESTION:**
{user_query}

**INSTRUCTIONS:**
1. Prefer the cited text above. If it contains the answer, use it and quote relevant parts.
2. If the user's question cannot be answered from the cited text alone (e.g. they ask for the firm name, employer, or details that appear in another section), use the full document content provided above to find the answer.
3. Do NOT say the information is not in the document if it appears in the full document content.
4. Be concise but thorough.
5. Do NOT say you need to search documents - you have the cited text and full document above.
6. Include [1] citation marker when referencing the document.

Provide a direct, helpful answer:"""

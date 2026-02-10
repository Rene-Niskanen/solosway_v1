"""
Main graph prompts: middleware summarization and force-chunk retrieval messages.

Callables:
- get_middleware_summary_prompt() -> str
- get_force_chunk_message_with_doc_ids(document_ids) -> str
- get_force_chunk_message_fallback() -> str
"""


def get_middleware_summary_prompt() -> str:
    """Prompt for SummarizationMiddleware (conversation history)."""
    return """Summarize the conversation history concisely.

Focus on:
1. User's primary questions and goals
2. Key facts discovered (property addresses, valuations, dates)
3. Documents referenced and their relevance
4. Open questions or unresolved issues

Keep the summary under 300 words. Be specific and factual."""


def get_force_chunk_message_with_doc_ids(document_ids: list) -> str:
    """System message forcing agent to call retrieve_chunks when document_ids are known."""
    doc_ids_str = str(document_ids[:3]) if document_ids else "[]"
    return f"""🚨 CRITICAL VIOLATION DETECTED:

You have identified {len(document_ids)} relevant document(s) but you have NOT retrieved any document text.

**YOU ARE NOT ALLOWED TO ANSWER DOCUMENT-BASED QUESTIONS WITHOUT RETRIEVING CHUNKS.**

**YOU MUST IMMEDIATELY:**
1. Call retrieve_chunks(document_ids={doc_ids_str}, query="...") with the document IDs you found
2. Wait for the chunk text to be returned
3. THEN answer based on the chunk content

**REMEMBER:**
- Document metadata (filenames, IDs, scores) is NOT sufficient evidence
- Chunk text is the ONLY source of truth for answering questions
- You cannot answer without chunk content

Proceed immediately with chunk retrieval."""


def get_force_chunk_message_fallback() -> str:
    """Fallback system message when document IDs cannot be inferred."""
    return """🚨 CRITICAL: You have identified documents but NOT retrieved chunks.

You MUST call retrieve_chunks() before answering any document-based question.

Document metadata is NOT sufficient. You need actual chunk text to answer.

Proceed immediately with chunk retrieval."""

"""
Helpers for execution_results compatibility (retrieve_docs vs retrieve_documents).

Agent_loop uses tool name "retrieve_documents"; executor uses "retrieve_docs".
Both produce document-level retrieval. Use these helpers for defensive checks.
"""


def is_doc_retrieval_action(action: str) -> bool:
    """True if action is document-level retrieval (retrieve_docs or retrieve_documents)."""
    return action in ("retrieve_docs", "retrieve_documents")

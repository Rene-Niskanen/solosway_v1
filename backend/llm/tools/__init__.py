"""
Central tool registry - single source of truth for LLM-callable tools.
"""

from backend.llm.tools.document_retriever_tool import create_document_retrieval_tool
from backend.llm.tools.chunk_retriever_tool import create_chunk_retrieval_tool
from backend.llm.tools.workspace_file_tool import (
    create_read_workspace_file_tool,
    create_write_workspace_file_tool,
)


def get_retrieval_tools():
    """Document + chunk retrieval tools (Level 1 + Level 2 RAG)."""
    return [
        create_document_retrieval_tool(),
        create_chunk_retrieval_tool(),
    ]


def get_workspace_tools():
    """USER.md read/write tools."""
    return [
        create_read_workspace_file_tool(),
        create_write_workspace_file_tool(),
    ]

"""
Citation Architecture - Layered System

This package implements a clean, layered architecture for citation handling:
- document_store: Low-level data access
- evidence_extractor: Intelligence layer (extraction logic)
- evidence_registry: Deterministic truth table
- citation_mapper: LLM boundary enforcement
"""

from backend.llm.citation.document_store import (
    fetch_chunk_blocks,
    fetch_chunks,
    fetch_document_filename
)

from backend.llm.citation.evidence_extractor import (
    EvidenceBlock,
    extract_evidence_blocks_from_chunks,
    extract_atomic_facts_from_block,
    extract_clause_evidence_from_block
)

from backend.llm.citation.evidence_registry import (
    deduplicate_evidence_blocks,
    rank_evidence_by_relevance,
    create_evidence_registry,
    format_evidence_table_for_llm
)

from backend.llm.citation.citation_mapper import (
    map_citation_numbers_to_citations,
    deduplicate_and_renumber_citations,
    extract_citations_from_answer_text
)

__all__ = [
    # Document Store
    'fetch_chunk_blocks',
    'fetch_chunks',
    'fetch_document_filename',
    # Evidence Extractor
    'EvidenceBlock',
    'extract_evidence_blocks_from_chunks',
    'extract_atomic_facts_from_block',
    'extract_clause_evidence_from_block',
    # Evidence Registry
    'deduplicate_evidence_blocks',
    'rank_evidence_by_relevance',
    'create_evidence_registry',
    'format_evidence_table_for_llm',
    # Citation Mapper
    'map_citation_numbers_to_citations',
    'deduplicate_and_renumber_citations',
    'extract_citations_from_answer_text',
]


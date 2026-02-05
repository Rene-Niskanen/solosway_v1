"""
Evidence Registry - Layer 3: Deterministic truth table.

Manages evidence deduplication, ranking, and formatting for LLM.
Responsibilities:
- Deduplicate evidence blocks
- Rank evidence by relevance to query
- Create evidence registry (evidence_id → EvidenceBlock)
- Format evidence table for LLM (with citation numbers [1], [2], [3])
- Generate citation number → evidence_id mapping

Rules:
- ✅ Deterministic (same input → same output)
- ✅ Testable without LLM
- ✅ No database access
- ✅ No LLM calls
- ❌ No citation mapping (that's citation_mapper's job)
"""

import logging
from typing import List, Dict, Tuple
from backend.llm.citation.evidence_extractor import EvidenceBlock

logger = logging.getLogger(__name__)


def deduplicate_evidence_blocks(evidence_blocks: List[EvidenceBlock]) -> List[EvidenceBlock]:
    """
    Remove duplicate evidence blocks.
    
    Rules:
    1. Same block + same fact = duplicate (same chunk_id, block_index, exact_text)
    2. Same fact + different block = keep both (different sources)
    3. Similar fact + same block = keep first (subset/superset)
    
    Args:
        evidence_blocks: List of EvidenceBlock objects
        
    Returns:
        Deduplicated list of EvidenceBlock objects
    """
    seen = set()
    unique_blocks = []
    
    for block in evidence_blocks:
        key = (block.chunk_id, block.block_index, block.exact_text.lower().strip())
        if key not in seen:
            seen.add(key)
            unique_blocks.append(block)
    
    logger.info(f"[EVIDENCE_REGISTRY] Deduplicated {len(evidence_blocks)} → {len(unique_blocks)} evidence blocks")
    return unique_blocks


def rank_evidence_by_relevance(
    evidence_blocks: List[EvidenceBlock],
    query: str,
    top_k: int = 30  # Increased from 15 for better coverage
) -> List[EvidenceBlock]:
    """
    Rank evidence blocks by relevance to query and return top K.
    
    Scoring:
    - Keyword match in label/text: +20-50 points
    - Fact type match (rent query → rent evidence): +30 points
    - Page number > 0: +5 points (prefer content pages over cover)
    
    Args:
        evidence_blocks: List of EvidenceBlock objects
        query: User query string
        top_k: Number of top evidence blocks to return (default: 15)
        
    Returns:
        Top K most relevant evidence blocks, sorted by relevance score
    """
    if not evidence_blocks:
        return []
    
    query_lower = query.lower()
    scored_blocks = []
    
    # Extract key terms from query (remove common words)
    common_words = {'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'what', 'where', 'when', 'who', 'how', 'can', 'could', 'should', 'would', 'please', 'give', 'me', 'tell', 'show'}
    query_terms = set(word for word in query_lower.split() if word not in common_words and len(word) > 2)
    
    for block in evidence_blocks:
        score = 0
        
        # Keyword matching in label and text
        label_lower = block.label.lower()
        text_lower = block.text_preview.lower()
        
        # Score based on term overlap
        label_terms = set(label_lower.split())
        text_terms = set(text_lower.split())
        
        label_overlap = len(query_terms & label_terms)
        text_overlap = len(query_terms & text_terms)
        
        score += label_overlap * 20  # Label matches are more important
        score += text_overlap * 10
        
        # Fact type matching (query intent → evidence type)
        if 'rent' in query_lower and 'rent' in label_lower:
            score += 30
        if 'address' in query_lower and 'address' in label_lower:
            score += 30
        if any(word in query_lower for word in ['date', 'period', 'term', 'when']) and any(word in label_lower for word in ['date', 'period', 'term', 'start', 'end']):
            score += 30
        if 'value' in query_lower or 'price' in query_lower or 'cost' in query_lower:
            if any(word in label_lower for word in ['value', 'price', 'cost', 'amount', 'fee']):
                score += 30
        if 'name' in query_lower or 'who' in query_lower:
            if any(word in label_lower for word in ['name', 'agent', 'party', 'tenant', 'landlord']):
                score += 30
        
        # Prefer content pages (page > 0)
        if block.page > 0:
            score += 5
        
        # Prefer atomic evidence over clause for factual queries
        if 'rent' in query_lower or 'address' in query_lower or 'date' in query_lower:
            if block.evidence_type == "atomic":
                score += 10
        
        scored_blocks.append((score, block))
    
    # Sort by score (descending) and return top K
    scored_blocks.sort(key=lambda x: x[0], reverse=True)
    top_blocks = [block for _, block in scored_blocks[:top_k]]
    
    # Log top scores for debugging
    if scored_blocks:
        top_scores = [score for score, _ in scored_blocks[:5]]
        logger.info(f"[EVIDENCE_REGISTRY] Ranked {len(evidence_blocks)} → {len(top_blocks)} evidence blocks (top {top_k}, top scores: {top_scores})")
    
    return top_blocks


def create_evidence_registry(
    evidence_blocks: List[EvidenceBlock], 
    request_id: str
) -> Tuple[Dict[str, EvidenceBlock], Dict[int, str]]:
    """
    Create evidence registry with request-scoped IDs and citation number mapping.
    
    Args:
        evidence_blocks: List of EvidenceBlock objects
        request_id: UUID for request-scoped evidence IDs
        
    Returns:
        Tuple of:
        - evidence_registry: Dict mapping evidence_id -> EvidenceBlock
        - citation_num_to_evidence_id: Dict mapping citation_number (1, 2, 3...) -> evidence_id
    """
    registry = {}
    citation_num_to_evidence_id = {}
    citation_number = 1
    
    for block in evidence_blocks:
        # Ensure evidence_id has request_id prefix
        if not block.evidence_id.startswith(request_id):
            # Re-number with request_id prefix
            evidence_num = block.evidence_id.split(':')[-1] if ':' in block.evidence_id else block.evidence_id
            block.evidence_id = f"{request_id}:{evidence_num}"
        
        registry[block.evidence_id] = block
        # Map citation number to evidence_id for reverse lookup
        citation_num_to_evidence_id[citation_number] = block.evidence_id
        citation_number += 1
    
    logger.info(f"[EVIDENCE_REGISTRY] Created registry with {len(registry)} evidence blocks")
    return registry, citation_num_to_evidence_id


def format_evidence_table_for_llm(
    evidence_registry: Dict[str, EvidenceBlock], 
    citation_num_to_evidence_id: Dict[int, str],
    query: str = ""
) -> str:
    """
    Format evidence table for LLM with guardrails, using sequential citation numbers [1], [2], [3].
    
    Args:
        evidence_registry: Dict mapping evidence_id -> EvidenceBlock
        citation_num_to_evidence_id: Dict mapping citation_number -> evidence_id
        query: User query for query-aware citation rules
        
    Returns:
        Formatted string with evidence table and citation rules
    """
    evidence_lines = []
    evidence_lines.append("**EVIDENCE (cite [1], [2], [3] only):**\n")
    
    # Sort by citation number for consistent ordering
    sorted_citations = sorted(citation_num_to_evidence_id.items(), key=lambda x: x[0])
    
    for citation_number, evidence_id in sorted_citations:
        block = evidence_registry.get(evidence_id)
        if not block:
            continue
        
        # Truncate text_preview to 200 characters for better context (increased from 50)
        preview = block.text_preview[:200] + "..." if len(block.text_preview) > 200 else block.text_preview
        
        # Format based on evidence type, using sequential citation numbers
        if block.evidence_type == "clause":
            evidence_lines.append(f"[{citation_number}] Clause: {preview}")
        else:
            evidence_lines.append(f"[{citation_number}] {block.label}: {preview}")
    
    evidence_lines.append("\n**CITATION RULES (MANDATORY):**")
    evidence_lines.append("1. You may ONLY cite citation numbers from the list above")
    evidence_lines.append("2. For factual questions, cite ALL relevant evidence - don't just cite one")
    evidence_lines.append("3. Each key fact should have its own citation")
    evidence_lines.append("4. Use citation numbers [1], [2], [3] immediately after each fact")
    evidence_lines.append("5. Do NOT invent or paraphrase source text")
    evidence_lines.append("6. Do NOT output source text - only reference citation numbers")
    evidence_lines.append("7. If no evidence supports the answer, say \"The document does not specify this.\"")
    evidence_lines.append("8. Each sentence may cite multiple citation numbers if needed")
    
    # Query-aware citation rules
    query_lower = query.lower() if query else ""
    if 'rent' in query_lower:
        evidence_lines.append("\n**FOR RENT QUERIES:**")
        evidence_lines.append("- You MUST cite ALL rent-related evidence")
        evidence_lines.append("- Example: '[AMOUNT] [1] is the monthly rent, which includes service charges [2] and is payable monthly [3].'")
        evidence_lines.append("- If multiple rent amounts exist, cite all of them")
    elif 'address' in query_lower:
        evidence_lines.append("\n**FOR ADDRESS QUERIES:**")
        evidence_lines.append("- You MUST cite ALL address-related evidence")
        evidence_lines.append("- Example: '[PROPERTY_ID] [1] is the property; [STREET_NAME] [2], [CITY] [3] is the address.'")
    elif any(word in query_lower for word in ['date', 'period', 'term', 'when']):
        evidence_lines.append("\n**FOR DATE/PERIOD QUERIES:**")
        evidence_lines.append("- You MUST cite ALL date-related evidence")
        evidence_lines.append("- Example: '[START_DATE] [1] is the lease start and [END_DATE] [2] is the end date.'")
    
    evidence_lines.append("\n**EXAMPLES:**")
    evidence_lines.append("✅ CORRECT: \"[AMOUNT] [1] is the market value as of [DATE] [2].\"")
    evidence_lines.append("✅ CORRECT: \"[AMOUNT] [1] is the monthly rent, which includes service charges [2] and is payable monthly [3].\"")
    evidence_lines.append("✅ CORRECT: \"The document does not specify the property's insurance requirements.\"")
    evidence_lines.append("❌ WRONG: \"The property has a market value of [AMOUNT] [1].\" (lead-in before figure; put figure first)")
    evidence_lines.append("❌ WRONG: \"The property value is approximately [AMOUNT] [1].\" (paraphrasing)")
    evidence_lines.append("❌ WRONG: \"The rent is [AMOUNT] [1].\" (missing service charge citation [2])")
    
    return "\n".join(evidence_lines)


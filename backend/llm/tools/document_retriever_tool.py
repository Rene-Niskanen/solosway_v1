"""
Tool for Level 1 retrieval: Finding relevant documents.

This tool searches document-level embeddings (not chunks) to find the most relevant
documents for a query. The agent should use this FIRST before searching chunks.

Uses hybrid search: Vector similarity (semantic) + Keyword/BM25 (lexical) for
improved recall, especially for exact matches like parcel numbers, plot IDs, etc.
"""

from typing import List, Dict, Optional, Literal
import logging
import os
import json
from concurrent.futures import ThreadPoolExecutor
from pydantic import BaseModel, Field
from langchain_core.tools import StructuredTool
from backend.services.supabase_client_factory import get_supabase_client, create_supabase_client_uncached

logger = logging.getLogger(__name__)

# Default patterns that indicate a summary is about another property/location (not the query entity).
# Override via entity_gate_config.json "conflicting_location_patterns".
_DEFAULT_CONFLICTING_LOCATION_PATTERNS = [
    "dik dik",
    "dik dik lane",
    "nzohe",
    "2327/30",
    "l.r. no: 2327",
    "3 dik dik",
    "langata",
    "mellifera",
    "carlos espindola",
    "martin wainaina",
]

# Tokens we do NOT count as "entity in summary" - they're too generic (e.g. "lane" appears in "Dik Dik Lane").
# Only distinctive tokens (e.g. "banda", "nzohe") should require presence in summary.
_GENERIC_ENTITY_TOKENS = frozenset({
    "lane", "road", "street", "property", "no", "block", "the", "offer", "lease",
    "agreement", "document", "file", "sale", "purchase", "valuation", "letter",
})


def _get_conflicting_location_patterns() -> List[str]:
    """Load conflicting_location_patterns from entity_gate_config.json or return default list."""
    try:
        config_dir = os.path.join(os.path.dirname(__file__), "..", "config")
        path = os.path.join(config_dir, "entity_gate_config.json")
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and "conflicting_location_patterns" in data:
                patterns = data["conflicting_location_patterns"]
                if isinstance(patterns, list) and patterns:
                    return [str(p).strip().lower() for p in patterns if p]
    except Exception as e:
        logger.debug("Could not load conflicting_location_patterns: %s", e)
    return list(_DEFAULT_CONFLICTING_LOCATION_PATTERNS)


def _entity_mentioned_in_summary(summary: str, gate_phrases: List[str]) -> bool:
    """
    True if the summary contains the asked-for entity. Uses full phrases and
    distinctive tokens only (not generic words like "lane" that appear in "Dik Dik Lane").
    """
    if not gate_phrases or not (summary or "").strip():
        return False
    summary_lower = (summary or "").strip().lower()
    for phrase in gate_phrases:
        phrase_lower = (phrase or "").strip().lower()
        if phrase_lower and phrase_lower in summary_lower:
            return True
        for token in phrase_lower.split():
            if len(token) >= 2 and token not in _GENERIC_ENTITY_TOKENS and token in summary_lower:
                return True
    return False


def _summary_clearly_about_another_property(summary: str, gate_phrases: List[str]) -> bool:
    """
    Return True if the summary is clearly about another property:
    (1) No entity in summary but other address in summary -> exclude.
    (2) Both entity and other address in summary but other address dominates (first or more often) -> exclude.
    """
    if not gate_phrases:
        return False
    summary_lower = (summary or "").strip().lower()
    if not summary_lower:
        return False
    patterns = _get_conflicting_location_patterns()
    other_address_in_summary = any(p in summary_lower for p in patterns)
    entity_in_summary = _entity_mentioned_in_summary(summary, gate_phrases)
    if not other_address_in_summary:
        return False
    if not entity_in_summary:
        return True
    # Both entity and other address: exclude if other address dominates (appears first or more often)
    entity_first_pos = len(summary_lower)
    for phrase in gate_phrases:
        phrase_lower = (phrase or "").strip().lower()
        if phrase_lower and phrase_lower in summary_lower:
            entity_first_pos = min(entity_first_pos, summary_lower.index(phrase_lower))
        for token in phrase_lower.split():
            if len(token) >= 2 and token not in _GENERIC_ENTITY_TOKENS and token in summary_lower:
                entity_first_pos = min(entity_first_pos, summary_lower.index(token))
    other_first_pos = len(summary_lower)
    for p in patterns:
        if p in summary_lower:
            other_first_pos = min(other_first_pos, summary_lower.index(p))
    # If other address appears before entity, or we have multiple other-address hits and few entity hits, treat as wrong doc
    if other_first_pos < entity_first_pos:
        return True
    other_count = sum(1 for p in patterns if p in summary_lower)
    entity_count = 0
    for phrase in gate_phrases:
        phrase_lower = (phrase or "").strip().lower()
        if phrase_lower:
            entity_count += summary_lower.count(phrase_lower)
        for token in phrase_lower.split():
            if len(token) >= 2 and token not in _GENERIC_ENTITY_TOKENS:
                entity_count += summary_lower.count(token)
    if other_count > entity_count:
        return True
    return False


class DocumentRetrievalInput(BaseModel):
    """Input schema for document retrieval tool."""
    query: str = Field(description="User query to find relevant documents")
    query_type: Optional[Literal["broad", "specific"]] = Field(
        None,
        description=(
            "Query classification for adaptive threshold control. "
            "'broad' for general queries (e.g., 'property documents', 'show me all reports') - uses lower threshold (0.15). "
            "'specific' for detailed queries (e.g., 'Example Property valuation report') - uses higher threshold (0.3). "
            "If not provided, system uses heuristic classification based on word count and generic terms."
        )
    )
    document_types: Optional[List[str]] = Field(
        None, 
        description="[DEPRECATED] Document type filtering has been removed. This parameter is ignored. All documents found by the retrieval system are included."
    )
    top_k: int = Field(
        8,
        description="Number of documents to return (default: 8)"
    )
    min_score: float = Field(
        0.7, 
        description="Minimum similarity score threshold (default: 0.7)"
    )
    business_id: Optional[str] = Field(
        None,
        description="Optional business UUID to filter results (for multi-tenancy)"
    )


def retrieve_documents(
    query: str,
    query_type: Optional[str] = None,
    document_types: Optional[List[str]] = None,
    top_k: Optional[int] = None,
    min_score: Optional[float] = None,
    business_id: Optional[str] = None,
    search_goal: Optional[str] = None,
    property_id: Optional[str] = None,
    document_ids: Optional[List[str]] = None,
    user_query_for_entity: Optional[str] = None,
) -> List[Dict]:
    """
    Retrieve the most relevant documents for a query.
    
    This is Level 1 retrieval - finds documents, not chunks.
    Use this FIRST before searching chunks.
    
    The tool uses hybrid search (vector + keyword) to find documents:
    - Vector search: Semantic similarity on document summary embeddings (when HyDE is enabled, uses hypothetical-answer embedding; keyword search always uses the original query).
    - Keyword search: Full-text search on summary_text, filename, and JSONB metadata
    - Address/property search: Searches document_summary JSONB for property information
    - Score fusion: 70% vector + 30% keyword
    
    Args:
        query: User query (e.g., "What is the market value of the property?")
        query_type: Optional query classification ("broad" or "specific"). 
            "broad" for general queries (uses lower threshold 0.15). 
            "specific" for detailed queries (uses higher threshold 0.3 or min_score). 
            If None, uses heuristic classification.
        document_types: [DEPRECATED] Document type filtering removed - parameter ignored
        top_k: Number of documents to return (default: 8)
        min_score: Minimum similarity score threshold (default: 0.7)
        business_id: Optional business UUID to filter results (for multi-tenancy)
    
    Returns:
        List of document candidates with scores:
        [
            {
                "document_id": "uuid",
                "filename": "document.pdf",
                "document_type": "valuation_report",
                "score": 0.91,
                "vector_score": 0.95,
                "keyword_score": 0.80,
                "summary": "Brief summary..."
            },
            ...
        ]
        
        Returns empty list if no documents meet the score threshold (triggers retry).
    """
    try:
        # Handle None defaults
        if top_k is None:
            top_k = 8
        if min_score is None:
            min_score = 0.7
        
        if not query or not query.strip():
            logger.warning("Empty query provided to retrieve_documents")
            return []
        
        # Query embedding for vector search (HyDE when enabled, else raw query). Keyword search always uses original query.
        from backend.llm.hyde import get_query_embedding_for_retrieval
        query_embedding = get_query_embedding_for_retrieval(query)
        if query_embedding is None:
            logger.error("Failed to generate query embedding for document search")
            return []
        logger.debug(f"Query embedding ({len(query_embedding)} dimensions) for document search")
        
        # Get Supabase client
        supabase = get_supabase_client()
        
        # HYBRID SEARCH: Vector + Keyword (BM25) + Address/Property + Metadata
        # This is critical for exact matches (parcel numbers, plot IDs, L.R. numbers, addresses)
        
        # 1 & 2. Run vector and keyword search in parallel (same results, lower latency)
        def _run_vector_search(supabase_client, q_embedding, s_goal, q_type, m_score, t_k):
            out = []
            try:
                if s_goal == "summarize":
                    search_threshold = 0.1
                elif q_type == "broad":
                    search_threshold = 0.22
                else:
                    m_score = m_score if m_score is not None else 0.7
                    search_threshold = min(m_score, 0.32)
                vector_response = supabase_client.rpc(
                    'match_document_embeddings',
                    {'query_embedding': q_embedding, 'match_threshold': search_threshold, 'match_count': t_k * 3}
                ).execute()
                out = vector_response.data or []
                logger.debug(f"   Vector search found {len(out)} documents (threshold: {search_threshold})")
            except Exception as e:
                logger.error(f"Vector search failed: {e}")
            return out

        def _run_keyword_search(q, b_id, t_k):
            out = []
            try:
                client = create_supabase_client_uncached()
                keyword_query = client.table('documents').select(
                    'id, original_filename, classification_type, summary_text, document_summary'
                )
                if b_id:
                    try:
                        from uuid import UUID
                        UUID(b_id)
                        keyword_query = keyword_query.eq('business_uuid', b_id)
                    except (ValueError, TypeError):
                        keyword_query = keyword_query.eq('business_id', b_id)
                if len((q or '').strip()) > 0:
                    query_lower = (q or '').lower().strip()
                    query_words = [w for w in query_lower.split() if len(w) > 3]
                    or_conditions = [
                        f'summary_text.ilike.%{query_lower}%',
                        f'original_filename.ilike.%{query_lower}%',
                    ]
                    if len(query_words) >= 1:
                        for word in query_words:
                            or_conditions.append(f'summary_text.ilike.%{word}%')
                            or_conditions.append(f'original_filename.ilike.%{word}%')
                        for i in range(len(query_words) - 1):
                            w1, w2 = query_words[i], query_words[i + 1]
                            if len(w1) > 2 and len(w2) > 2:
                                phrase_underscore = f"{w1}_{w2}"
                                or_conditions.append(f'original_filename.ilike.%{phrase_underscore}%')
                                or_conditions.append(f'summary_text.ilike.%{phrase_underscore}%')
                    if or_conditions:
                        keyword_query = keyword_query.or_(','.join(or_conditions))
                keyword_response = keyword_query.limit(t_k * 3).execute()
                out = keyword_response.data or []
                logger.debug(f"   Keyword search found {len(out)} documents")
                if not out and (q or '').strip() and b_id:
                    words = [w for w in (q or '').lower().strip().split() if len(w) > 3]
                    words = sorted(words, key=len, reverse=True)
                    for word in words:
                        fb = client.table('documents').select(
                            'id, original_filename, classification_type, summary_text, document_summary'
                        ).eq('business_uuid', b_id).ilike('original_filename', f'%{word}%').limit(t_k * 2).execute()
                        if fb.data:
                            out = fb.data
                            logger.info(f"   Fallback filename search for %r found {len(out)} documents", word)
                            break
            except Exception as e:
                logger.warning(f"Keyword search failed (non-fatal): {e}")
            return out

        logger.debug(f"🔍 Running vector and keyword search in parallel for query: {query[:50]}...")
        with ThreadPoolExecutor(max_workers=2) as executor:
            future_vector = executor.submit(_run_vector_search, supabase, query_embedding, search_goal, query_type, min_score, top_k)
            future_keyword = executor.submit(_run_keyword_search, query, business_id, top_k)
            vector_results = future_vector.result()
            keyword_results = future_keyword.result()
        logger.debug(f"   Parallel search done: vector={len(vector_results)}, keyword={len(keyword_results)}")

        # 3. Filter vector results by business_id if provided
        # (RPC function doesn't support WHERE clauses, so filter post-retrieval)
        if business_id:
            try:
                from uuid import UUID
                UUID(business_id)  # Validate UUID format
                # Need to fetch business_uuid for each document
                doc_ids = [str(doc.get('id', '')) for doc in vector_results if doc.get('id')]
                if doc_ids:
                    business_check = supabase.table('documents').select('id, business_uuid').in_('id', doc_ids).execute()
                    business_map = {str(doc['id']): doc.get('business_uuid') for doc in business_check.data or []}
                    vector_results = [doc for doc in vector_results if str(doc.get('id', '')) in business_map and str(business_map.get(str(doc.get('id', '')))) == business_id]
                    logger.debug(f"   Filtered vector results by business_uuid: {len(vector_results)} documents")
            except (ValueError, TypeError):
                # Not a UUID, skip business filtering for vector results
                logger.warning(f"   business_id '{business_id}' is not a valid UUID, skipping business filter for vector results")
        
        # 4. Combine and deduplicate results
        vector_results_dict = {}
        for doc in vector_results:
            doc_id = str(doc.get('id', ''))
            if not doc_id:
                continue
            
            vector_results_dict[doc_id] = {
                'document_id': doc_id,
                'filename': doc.get('original_filename', 'unknown'),
                'document_type': doc.get('classification_type'),
                'vector_score': float(doc.get('similarity', 0.0)),
                'keyword_score': 0.0,
                'summary_text': ''  # Filled from keyword_results when present; used for entity gating
            }
        
        # 5. Add keyword matches with quality-based scoring
        query_lower = query.lower().strip()
        query_words = [w for w in query_lower.split() if len(w) > 3]  # Only words longer than 3 chars
        
        for doc in keyword_results:
            doc_id = str(doc.get('id', ''))
            if not doc_id:
                continue
            
            # Calculate keyword match quality
            filename = (doc.get('original_filename', '') or '').lower()
            summary = (doc.get('summary_text', '') or '').lower()
            
            keyword_score = 0.0
            match_quality = []
            
            # Exact filename match (highest quality)
            if query_lower in filename:
                keyword_score = max(keyword_score, 0.8)
                match_quality.append('exact_filename')
            # Partial filename match (high quality)
            elif any(word in filename for word in query_words if len(word) > 3):
                keyword_score = max(keyword_score, 0.6)
                match_quality.append('partial_filename')
            
            # Exact summary match (high quality)
            if query_lower in summary:
                keyword_score = max(keyword_score, 0.7)
                match_quality.append('exact_summary')
            # Partial summary match (medium quality)
            elif any(word in summary for word in query_words if len(word) > 3):
                keyword_score = max(keyword_score, 0.4)
                match_quality.append('partial_summary')
            
            # Generic word matches (lower quality) - only if no better match
            if keyword_score < 0.3:
                matched_words = sum(1 for word in query_words if word in filename or word in summary)
                if matched_words > 0:
                    keyword_score = min(0.3, 0.1 * matched_words)  # 0.1 per word, max 0.3
                    match_quality.append(f'word_match_{matched_words}')
            
            # Ensure minimum score for any keyword match
            if keyword_score == 0.0:
                keyword_score = 0.2  # Fallback for any match
            
            if doc_id in vector_results_dict:
                # Document found in both searches - boost keyword score and store summary for entity gating
                vector_results_dict[doc_id]['keyword_score'] = min(1.0, keyword_score + 0.1)  # Small boost
                vector_results_dict[doc_id]['summary_text'] = (doc.get('summary_text') or '').lower()
                logger.debug(f"   Document {doc_id[:8]} keyword match: {match_quality} (score: {vector_results_dict[doc_id]['keyword_score']:.2f})")
            else:
                # New document from keyword search only
                vector_results_dict[doc_id] = {
                    'document_id': doc_id,
                    'filename': doc.get('original_filename', 'unknown'),
                    'document_type': doc.get('classification_type'),
                    'vector_score': 0.0,
                    'keyword_score': keyword_score,
                    'summary_text': (doc.get('summary_text') or '').lower()
                }
                logger.debug(f"   Document {doc_id[:8]} keyword-only match: {match_quality} (score: {keyword_score:.2f})")
        
        # 6. Calculate combined score (weighted)
        results = []
        for doc_id, doc_data in vector_results_dict.items():
            # REMOVED: Document type filtering - we trust the retrieval system's ranking.
            # All documents found by vector/keyword search are included regardless of classification.
            
            # Combined score with adaptive weighting
            vector_score = doc_data['vector_score']
            keyword_score = doc_data['keyword_score']
            
            # Penalize documents with very low vector scores (likely not semantically relevant)
            # If vector score is very low (< 0.2), reduce its weight in the combination
            if vector_score < 0.2 and keyword_score > 0:
                # When vector score is low but keyword matched, reduce vector weight
                # This prevents generic queries from matching everything weakly
                vector_weight = 0.3  # Reduced from 0.7
                keyword_weight = 0.7  # Increased from 0.3
            elif vector_score > 0 and keyword_score > 0:
                # Both found - balanced weighting (slight preference for vector)
                vector_weight = 0.65
                keyword_weight = 0.35
            elif vector_score > 0:
                # Only vector found - use vector score directly
                vector_weight = 1.0
                keyword_weight = 0.0
            else:
                # Only keyword found - use keyword score but with penalty
                vector_weight = 0.0
                keyword_weight = 1.0
                # Apply penalty for keyword-only matches (they're less reliable)
                keyword_score = keyword_score * 0.8
            
            combined_score = (vector_score * vector_weight) + (keyword_score * keyword_weight)
            
            results.append({
                'document_id': doc_id,
                'filename': doc_data['filename'],
                'document_type': doc_data['document_type'],
                'score': round(combined_score, 4),
                'vector_score': round(doc_data['vector_score'], 4),
                'keyword_score': round(doc_data['keyword_score'], 4),
                'summary_text': (doc_data.get('summary_text') or '')
            })
        
        # 6b. Entity-aware filtering: one gate + wrong-property exclusion (only when query is about a specific entity)
        from backend.llm.utils.entity_extraction import get_entity_gate_phrases
        entity_query = (user_query_for_entity or query or "").strip()
        gate_phrases = get_entity_gate_phrases(entity_query) if entity_query else []
        
        # Fetch summaries for all results (needed for entity and wrong-property checks)
        missing_summary_ids = [r['document_id'] for r in results if not (r.get('summary_text') or '').strip()]
        if missing_summary_ids:
            try:
                summary_resp = supabase.table('documents').select('id, summary_text').in_('id', missing_summary_ids[:50]).execute()
                for row in (summary_resp.data or []):
                    doc_id = str(row.get('id', ''))
                    summary = (row.get('summary_text') or '').lower()
                    for r in results:
                        if r.get('document_id') == doc_id:
                            r['summary_text'] = summary
                            break
            except Exception as e:
                logger.debug("   Could not fetch missing summaries: %s", e)
        
        if gate_phrases:
            # Boost docs that mention the entity in filename (helps ranking)
            ENTITY_BOOST = 0.28
            for r in results:
                _fn = (r.get('filename') or '').lower().replace('_', ' ').replace('-', ' ')
                if any(_phrase in _fn for _phrase in gate_phrases):
                    r['score'] = round(r['score'] + ENTITY_BOOST, 4)
            
            # Single gate: keep only docs whose summary mentions the entity (distinctive token, e.g. "banda").
            # No "filename or summary" – summary is source of truth so we don't surface wrong property.
            results_before = list(results)
            results = [r for r in results if _entity_mentioned_in_summary(r.get('summary_text', ''), gate_phrases)]
            if not results and results_before:
                logger.warning(
                    "   Entity-in-summary would leave 0 docs; relaxing (keeping %d). Prefer adding summaries to docs.",
                    len(results_before),
                )
                results = results_before
            elif len(results) < len(results_before):
                logger.info(
                    "   Entity-in-summary: kept %d docs (dropped %d with no entity in summary)",
                    len(results),
                    len(results_before) - len(results),
                )
            
            if not results:
                logger.warning("   No documents mention the asked-for entity (e.g. %s). Returning empty list.", gate_phrases[:3])
                return []
            
            # Exclude docs clearly about another property (other address in summary, entity absent or dominated)
            results_before_excl = list(results)
            results = [r for r in results if not _summary_clearly_about_another_property(r.get('summary_text', ''), gate_phrases)]
            excluded_count = len(results_before_excl) - len(results)
            if excluded_count > 0:
                for r in results_before_excl:
                    if r not in results and _summary_clearly_about_another_property(r.get('summary_text', ''), gate_phrases):
                        logger.info("   Excluded doc %s (%s): wrong property", (r.get('document_id') or '')[:8], (r.get('filename') or '')[:50])
                if not results:
                    logger.warning("   Wrong-property exclusion would leave 0 docs; relaxing.")
                    results = results_before_excl
                else:
                    logger.info("   Wrong-property exclusion: removed %d doc(s), kept %d", excluded_count, len(results))
            
            # Rank docs with entity in summary above any that slipped through (e.g. after relaxation)
            ENTITY_IN_SUMMARY_BOOST = 0.15
            for r in results:
                if _entity_mentioned_in_summary(r.get('summary_text', ''), gate_phrases):
                    r['score'] = round(r['score'] + ENTITY_IN_SUMMARY_BOOST, 4)
        
        # Sort by combined score (descending)
        results.sort(key=lambda x: x['score'], reverse=True)
        # Remove summary_text from results so it is not sent to the agent (used only for entity gating)
        for r in results:
            r.pop('summary_text', None)

        # 6c. SCOPE FILTER: When user has scope (property_id or document_ids), restrict to in-scope docs only
        if document_ids and len(document_ids) > 0:
            allowed_ids = set(str(d) for d in document_ids if d)
            results = [r for r in results if r.get('document_id') in allowed_ids]
            if not results:
                logger.info("   Scope filter (document_ids): no results in scope, returning []")
                return []
        elif property_id:
            try:
                rel_result = supabase.table('document_relationships').select('document_id').eq('property_id', property_id).execute()
                allowed_ids = set(str(r['document_id']) for r in (rel_result.data or []) if r.get('document_id'))
                if allowed_ids:
                    results = [r for r in results if r.get('document_id') in allowed_ids]
                if not results:
                    logger.info("   Scope filter (property_id): no results in scope, returning []")
                    return []
            except Exception as e:
                logger.warning("   Scope filter (property_id) failed: %s", e)
        
        # 7. GUARDRAIL: Adaptive threshold. Use stricter (specific) when we have entity gate phrases.
        if gate_phrases:
            is_broad_query = False
            logger.debug("   Entity-specific query: using specific threshold")
        elif query_type and (query_type or '').lower() in ["broad", "specific"]:
            is_broad_query = ((query_type or '').lower() == "broad")
            logger.debug(f"   Using planner query_type: {query_type}")
        else:
            is_broad_query = True
            logger.debug("   No query_type; defaulting to broad")
        
        # 7b. Minimum combined score and minimum vector score (reduce irrelevant docs)
        MIN_COMBINED_SCORE_SPECIFIC = 0.30  # Slightly relaxed so queries like "value of highlands" still return a doc
        MIN_COMBINED_SCORE_BROAD = 0.28
        FALLBACK_MIN_SCORE = 0.22  # If nothing passes main threshold, allow single best doc above this
        MIN_VECTOR_SCORE = 0.12  # Exclude pure keyword-only matches; 0.12 allows borderline semantic matches
        # Strong filename match (e.g. query "highlands" vs doc "Highlands.pdf") - allow even if vector is low
        MIN_KEYWORD_SCORE_FILENAME_PASSTHROUGH = 0.5

        min_combined = MIN_COMBINED_SCORE_BROAD if is_broad_query else MIN_COMBINED_SCORE_SPECIFIC
        filtered_results = [
            r for r in results
            if r["score"] >= min_combined
            and (r["vector_score"] >= MIN_VECTOR_SCORE or r["keyword_score"] >= MIN_KEYWORD_SCORE_FILENAME_PASSTHROUGH)
        ]

        if not filtered_results and results:
            best = results[0]
            passes_vector = best["vector_score"] >= MIN_VECTOR_SCORE
            passes_filename = best["keyword_score"] >= MIN_KEYWORD_SCORE_FILENAME_PASSTHROUGH
            if best["score"] >= FALLBACK_MIN_SCORE and (passes_vector or passes_filename):
                filtered_results = [best]
                logger.info(
                    f"   No docs above threshold {min_combined}; using single best (score={best['score']:.3f})"
                )

        if not filtered_results:
            logger.warning(
                f"⚠️ No documents found. "
                f"Top score was {results[0]['score'] if results else 'N/A'}. "
                f"Returning empty list to trigger retry/fallback."
            )
            return []
        
        # 8. Filter out documents with 0 chunks (unprocessed documents) - single batch query
        # CRITICAL: Documents without chunks cannot be used for chunk retrieval
        doc_ids_to_check = [doc['document_id'] for doc in filtered_results]
        documents_with_chunks = []
        if doc_ids_to_check:
            try:
                # One query: get document_ids that have at least one chunk (build set from rows)
                chunk_check = supabase.table('document_vectors').select(
                    'document_id'
                ).in_('document_id', doc_ids_to_check).limit(5000)
                chunk_resp = chunk_check.execute()
                rows = chunk_resp.data or []
                doc_ids_with_chunks = set(str(r.get('document_id', '')) for r in rows if r.get('document_id'))
                for doc in filtered_results:
                    doc_id = doc['document_id']
                    if doc_id in doc_ids_with_chunks:
                        documents_with_chunks.append(doc)
                        logger.debug(f"   ✅ Document {doc_id[:8]} ({doc.get('filename', 'unknown')}) has chunks")
                    else:
                        logger.warning(
                            f"   ⚠️ Document {doc_id[:8]} ({doc.get('filename', 'unknown')}) has 0 chunks - "
                            f"skipping (unprocessed document)"
                        )
            except Exception as e:
                logger.warning(f"   ⚠️ Batch chunk check failed: {e}, including all filtered docs")
                documents_with_chunks = list(filtered_results)

        if not documents_with_chunks:
            logger.warning(
                f"⚠️ All {len(filtered_results)} documents have 0 chunks (unprocessed). "
                f"Returning empty list to trigger retry/fallback."
            )
            return []
        
        # 9. Limit to top_k (but only from documents with chunks)
        final_results = documents_with_chunks[:top_k]
        
        logger.info(
            f"✅ Retrieved {len(final_results)} documents for query: '{query[:50]}...' "
            f"(vector: {len(vector_results)}, keyword: {len(keyword_results)}, "
            f"combined: {len(vector_results_dict)}, with_chunks: {len(documents_with_chunks)})"
        )
        
        # DEBUG: Log which documents were selected
        for idx, doc in enumerate(final_results):
            logger.info(
                f"   [{idx}] document_id={doc['document_id'][:8]}..., "
                f"filename={doc.get('filename', 'unknown')}, "
                f"score={doc.get('score', 0):.3f}, "
                f"type={doc.get('document_type', 'unknown')}"
            )
        
        return final_results
        
    except Exception as e:
        logger.error(f"Document retrieval failed: {e}")
        import traceback
        logger.debug(traceback.format_exc())
        return []


def create_document_retrieval_tool() -> StructuredTool:
    """
    Create a LangChain StructuredTool for document retrieval.
    
    This tool is designed to be used by the agent. The agent receives the user query
    and can call this tool with the query to find relevant documents.
    
    Returns:
        LangChain StructuredTool instance
    """
    tool_description = """
## PURPOSE
Retrieves the most relevant documents for a user query using hybrid search.

This is Level 1 retrieval - finds documents, not chunks. Use this FIRST before searching chunks.

## WHEN TO USE
- User asks a question that requires finding relevant documents
- You need to know which documents contain information about the query
- Before searching for specific chunks within documents

## HOW IT WORKS
1. Searches document-level embeddings (semantic similarity)
2. Also searches document summaries with keyword matching (exact matches)
3. Combines results with weighted scoring (70% vector + 30% keyword)
4. Returns top documents ranked by relevance

## PARAMETERS

### query (REQUIRED)
- The user's query/question
- Example: "What is the market value of the property?"
- Example: "Show me documents about Example Property"

### document_types (OPTIONAL)
- Filter results to specific document types
- Example: ["valuation_report"] - only valuation reports
- Example: ["letter_of_offer", "sale_agreement"] - only offers and agreements
- If not specified, searches all document types

### query_type (OPTIONAL, RECOMMENDED)
- Classification of query specificity: "broad" or "specific"
- **"broad"**: General queries asking for multiple documents or categories
  - Examples: "property documents", "show me all reports", "list documents", "property documents in Nairobi"
  - Uses lower threshold (0.15) for better recall
  - Use when: User wants to explore, browse, or see multiple documents
- **"specific"**: Detailed queries asking for specific information
  - Examples: "Example Property valuation report", "letter of offer for property X", "valuation for 123 Main Street"
  - Uses higher threshold (0.3 or min_score, whichever is higher) for better precision
  - Use when: User asks about a specific document, property, or precise information
- **If not provided**: System uses heuristic classification (word count, generic terms)
- **Recommendation**: Always provide query_type for better control over retrieval behavior

### When to use "broad":
- User asks for "all documents", "list of", "show me documents"
- Query contains generic terms: "documents", "details", "information"
- User wants to explore or browse documents
- Query is vague or exploratory

### When to use "specific":
- User asks about a specific document type or property
- Query contains specific identifiers: property names, addresses, document types
- User wants precise information, not exploration
- Query mentions specific details or constraints

### top_k (OPTIONAL, default: 8)
- Number of documents to return
- Range: 1-50 recommended
- Higher values = more documents but slower

### min_score (OPTIONAL, default: 0.7)
- Minimum similarity score (0.0-1.0)
- Higher = stricter matching (fewer but more relevant results)
- Lower = more lenient (more but potentially less relevant results)
- If no documents meet threshold, returns empty list (triggers retry)

## RETURN VALUE
List of documents with:
- document_id: UUID of the document (for use with retrieve_chunks)
- filename: Original filename
- document_type: Classification type (e.g., "valuation_report")
- score: Combined relevance score (0.0-1.0)
- vector_score: Semantic similarity score
- keyword_score: Keyword match score

**NOTE**: This tool returns metadata only. Use retrieve_chunks() to get actual document content.

## EXAMPLES

### Example 1: General Query
User: "What is the property valuation?"
→ Call: retrieve_documents(query="What is the property valuation?")
→ Returns: List of valuation documents

### Example 2: Filtered Query
User: "Show me valuation reports"
→ Call: retrieve_documents(
    query="valuation reports",
    query_type="broad"
)
→ Returns: Documents ranked by relevance to valuation reports

### Example 3: Specific Property Query
User: "What documents mention Example Property?"
→ Call: retrieve_documents(query="Example Property")
→ Returns: Documents mentioning Example Property

## IMPORTANT NOTES
- This tool finds DOCUMENTS, not specific chunks
- After getting documents, use retrieve_chunks() to find specific text within them
- If returns empty list, the guardrail triggered - retry with different query/parameters
- Hybrid search catches both semantic matches (vector) and exact matches (keyword)
- You can call this tool multiple times with different queries to explore the document space
- **Always provide query_type parameter for better control over retrieval behavior**
"""
    
    return StructuredTool.from_function(
        func=retrieve_documents,
        name="retrieve_documents",
        description=tool_description,
        args_schema=DocumentRetrievalInput
    )


"""
Tool for Level 1 retrieval: Finding relevant documents.

This tool searches document-level embeddings (not chunks) to find the most relevant
documents for a query. The agent should use this FIRST before searching chunks.

Uses hybrid search: Vector similarity (semantic) + Keyword/BM25 (lexical) for
improved recall, especially for exact matches like parcel numbers, plot IDs, etc.
"""

from typing import List, Dict, Optional, Literal
import logging
from pydantic import BaseModel, Field
from langchain_core.tools import StructuredTool
from backend.services.supabase_client_factory import get_supabase_client

logger = logging.getLogger(__name__)


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
        20, 
        description="Number of documents to return (default: 20)"
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
    search_goal: Optional[str] = None
) -> List[Dict]:
    """
    Retrieve the most relevant documents for a query.
    
    This is Level 1 retrieval - finds documents, not chunks.
    Use this FIRST before searching chunks.
    
    The tool uses hybrid search (vector + keyword) to find documents:
    - Vector search: Semantic similarity on document summary embeddings
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
        top_k: Number of documents to return (default: 20)
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
            top_k = 20
        if min_score is None:
            min_score = 0.7
        
        if not query or not query.strip():
            logger.warning("Empty query provided to retrieve_documents")
            return []
        
        # Generate query embedding using Voyage AI (matches database embeddings)
        # CRITICAL: Document embeddings use Voyage AI (1024 dimensions) to match database schema
        # This matches the embeddings stored in document_embedding column
        import os
        use_voyage = os.environ.get('USE_VOYAGE_EMBEDDINGS', 'true').lower() == 'true'
        
        if use_voyage:
            try:
                from voyageai import Client
                voyage_api_key = os.environ.get('VOYAGE_API_KEY')
                if not voyage_api_key:
                    logger.error("VOYAGE_API_KEY not set, cannot generate document embedding")
                    return []
                
                voyage_client = Client(api_key=voyage_api_key)
                voyage_model = os.environ.get('VOYAGE_EMBEDDING_MODEL', 'voyage-law-2')
                
                response = voyage_client.embed(
                    texts=[query],
                    model=voyage_model,
                    input_type='query'  # Use 'query' for query embeddings
                )
                query_embedding = response.embeddings[0]
                logger.debug(f"✅ Using Voyage AI embedding ({len(query_embedding)} dimensions) for document search")
            except Exception as e:
                logger.error(f"Failed to generate Voyage embedding: {e}")
                return []
        else:
            # Fallback to OpenAI if Voyage is disabled
            try:
                from openai import OpenAI
                openai_client = OpenAI(api_key=os.environ.get('OPENAI_API_KEY'))
                response = openai_client.embeddings.create(
                    model="text-embedding-3-small",
                    input=[query]
                )
                query_embedding = response.data[0].embedding
                logger.warning(f"⚠️ Using OpenAI embedding ({len(query_embedding)} dimensions) - Voyage is disabled")
            except Exception as e:
                logger.error(f"Failed to generate OpenAI embedding: {e}")
                return []
        
        # Get Supabase client
        supabase = get_supabase_client()
        
        # HYBRID SEARCH: Vector + Keyword (BM25) + Address/Property + Metadata
        # This is critical for exact matches (parcel numbers, plot IDs, L.R. numbers, addresses)
        
        # 1. Vector similarity search using match_document_embeddings() SQL function
        # NOTE: Function renamed from match_documents to avoid conflict with existing function
        # NOTE: Business filtering happens post-retrieval since RPC doesn't support WHERE clauses
        logger.debug(f"🔍 Vector search for query: {query[:50]}...")
        try:
            # ADAPTIVE THRESHOLD: Adjust based on search_goal and query_type
            # For "summarize" queries, use very low threshold (document name/type matching, not content similarity)
            # For other queries, use more lenient threshold than default
            if search_goal == "summarize":
                # Summarize queries: very lenient (0.1) - we're matching by document name/type, not content
                search_threshold = 0.1
                logger.debug(f"   Summarize query detected - using very lenient threshold: {search_threshold}")
            elif query_type == "broad":
                # Broad queries: lenient threshold (0.15)
                search_threshold = 0.15
                logger.debug(f"   Broad query - using lenient threshold: {search_threshold}")
            else:
                # Specific queries: more lenient than default (0.2 instead of 0.3)
                # This helps catch documents that might have lower similarity but are still relevant
                # Handle None min_score
                if min_score is None:
                    min_score = 0.7  # Default
                search_threshold = min(min_score, 0.2)  # Use lower of min_score or 0.2
                logger.debug(f"   Specific query - using threshold: {search_threshold}")
            
            vector_response = supabase.rpc(
                'match_document_embeddings',
                {
                    'query_embedding': query_embedding,
                    'match_threshold': search_threshold,  # Lower threshold for better recall
                    'match_count': top_k * 3  # Get more for reranking and business filtering
                }
            ).execute()
            
            vector_results = vector_response.data or []
            logger.debug(f"   Vector search found {len(vector_results)} documents (threshold: {search_threshold})")
            
            # Log sample results for debugging
            if vector_results:
                sample = vector_results[0]
                logger.debug(f"   Sample result: {sample.get('original_filename', 'unknown')[:30]}, similarity: {sample.get('similarity', 0):.3f}")
        except Exception as e:
            logger.error(f"Vector search failed: {e}")
            vector_results = []
        
        # 2. Keyword search (BM25/full-text) for exact matches
        logger.debug(f"🔍 Keyword search for query: {query[:50]}...")
        keyword_results = []
        try:
            # Use ILIKE pattern matching on summary_text and original_filename
            # This provides keyword matching for exact matches (parcel numbers, plot IDs, etc.)
            # Note: Full-text search via tsvector is available via GIN index, but Supabase
            # PostgREST doesn't expose PostgreSQL full-text search operators directly.
            # ILIKE is the most practical approach for now.
            
            # Build keyword search query
            keyword_query = supabase.table('documents').select(
                'id, original_filename, classification_type, summary_text, document_summary'
            )
            
            # Filter by business_id if provided (CRITICAL for multi-tenancy)
            if business_id:
                try:
                    from uuid import UUID
                    UUID(business_id)  # Validate UUID format
                    keyword_query = keyword_query.eq('business_uuid', business_id)
                    logger.debug(f"   Filtering by business_uuid: {business_id[:8]}...")
                except (ValueError, TypeError):
                    # Not a UUID, try business_id field
                    keyword_query = keyword_query.eq('business_id', business_id)
                    logger.debug(f"   Filtering by business_id: {business_id}")
            
            # Search for query text in multiple fields:
            # 1. summary_text (document content summary)
            # 2. original_filename (filename metadata)
            # 3. document_summary JSONB (addresses, property names, parties, etc.)
            # Split query into words for better matching (handles "letter of offer" matching "Letter_of_Offer")
            if len(query.strip()) > 0:
                query_lower = query.lower().strip()
                query_words = [w for w in query_lower.split() if len(w) > 3]  # Only words longer than 3 chars
                
                # Build OR conditions for keyword search
                or_conditions = []
                
                # Full query match in summary_text and filename
                or_conditions.append(f'summary_text.ilike.%{query_lower}%')
                or_conditions.append(f'original_filename.ilike.%{query_lower}%')
                
                # NOTE: JSONB search removed - PostgREST doesn't support ::text cast in OR conditions
                # The document_summary JSONB content is typically already reflected in summary_text
                # If JSONB-specific search is needed, we'll need a custom SQL function
                
                # Individual word matches (for cases like "letter of offer" matching "Letter_of_Offer")
                if len(query_words) > 1:
                    for word in query_words:
                        or_conditions.append(f'summary_text.ilike.%{word}%')
                        or_conditions.append(f'original_filename.ilike.%{word}%')
                        # Removed: document_summary::text.ilike (invalid syntax)
                
                # Apply OR conditions
                if or_conditions:
                    keyword_query = keyword_query.or_(','.join(or_conditions))
            
            # Execute keyword search
            keyword_response = keyword_query.limit(top_k * 3).execute()  # Get more for business filtering
            keyword_results = keyword_response.data or []
            logger.debug(f"   Keyword search found {len(keyword_results)} documents")
        except Exception as e:
            logger.warning(f"Keyword search failed (non-fatal): {e}")
            keyword_results = []
        
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
                'keyword_score': 0.0
                # Summary removed - LLM must retrieve chunks to get content
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
                # Document found in both searches - boost keyword score
                vector_results_dict[doc_id]['keyword_score'] = min(1.0, keyword_score + 0.1)  # Small boost
                logger.debug(f"   Document {doc_id[:8]} keyword match: {match_quality} (score: {vector_results_dict[doc_id]['keyword_score']:.2f})")
            else:
                # New document from keyword search only
                vector_results_dict[doc_id] = {
                    'document_id': doc_id,
                    'filename': doc.get('original_filename', 'unknown'),
                    'document_type': doc.get('classification_type'),
                    'vector_score': 0.0,
                    'keyword_score': keyword_score
                    # Summary removed - LLM must retrieve chunks to get content
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
                'keyword_score': round(doc_data['keyword_score'], 4)
                # Summary removed - LLM must retrieve chunks to get content
            })
        
        # Sort by combined score (descending)
        results.sort(key=lambda x: x['score'], reverse=True)
        
        # 7. GUARDRAIL: Adaptive threshold based on query specificity
        # Priority: LLM-provided query_type > Heuristic classification
        # Override min_score for broad queries to improve recall
        
        # Use LLM-provided query_type if available, otherwise fallback to heuristic
        if query_type:
            # Validate query_type (handle None)
            if (query_type or '').lower() not in ["broad", "specific"]:
                logger.warning(f"   Invalid query_type '{query_type}', falling back to heuristic classification")
                query_type = None
        
        if query_type:
            # Use LLM-provided classification (handle None)
            is_broad_query = ((query_type or '').lower() == "broad")
            logger.debug(f"   Using LLM-provided query_type: {query_type} (overriding heuristic)")
        else:
            # Fallback to heuristic classification
            query_lower = query.lower().strip()
            query_words = query_lower.split()
            query_words_count = len([w for w in query_words if len(w) > 3])
            total_words = len(query_words)
            
            # Generic terms that indicate broad queries
            generic_terms = ['documents', 'details', 'information', 'address', 'location', 'property documents']
            
            # Classify as broad if:
            # - Very few significant words (<= 2 words > 3 chars), OR
            # - Short query (<= 3 total words), OR
            # - Contains generic terms that make it less specific
            is_broad_query = (
                query_words_count <= 2 or 
                total_words <= 3 or
                (total_words <= 4 and any(generic in query_lower for generic in generic_terms))
            )
            logger.debug(f"   Using heuristic classification (LLM query_type not provided)")
        
        # REMOVED: Redundant guardrail threshold filtering
        # The vector search threshold already filters at the database level (0.15 for broad, 0.2 for specific)
        # The final fused scores are already filtered by the vector search, so no need for another filter layer
        # Use all results from fusion - the vector search threshold is sufficient
        filtered_results = results
        
        if not filtered_results:
            logger.warning(
                f"⚠️ No documents found. "
                f"Top score was {results[0]['score'] if results else 'N/A'}. "
                f"Returning empty list to trigger retry/fallback."
            )
            # Return empty to trigger retry/fallback in agent
            return []
        
        # 8. Filter out documents with 0 chunks (unprocessed documents)
        # CRITICAL: Documents without chunks cannot be used for chunk retrieval
        documents_with_chunks = []
        for doc in filtered_results:
            doc_id = doc['document_id']
            try:
                # Quick check: see if document has any chunks
                # Use limit(1) for efficiency - we only need to know if at least one chunk exists
                chunk_check = supabase.table('document_vectors').select(
                    'id'
                ).eq('document_id', doc_id).limit(1).execute()
                
                has_chunks = len(chunk_check.data or []) > 0
                
                if not has_chunks:
                    logger.warning(
                        f"   ⚠️ Document {doc_id[:8]} ({doc.get('filename', 'unknown')}) has 0 chunks - "
                        f"skipping (unprocessed document)"
                    )
                    continue
                
                # Document has chunks - include it
                documents_with_chunks.append(doc)
                logger.debug(
                    f"   ✅ Document {doc_id[:8]} ({doc.get('filename', 'unknown')}) has chunks"
                )
            except Exception as e:
                logger.warning(f"   ⚠️ Error checking chunks for document {doc_id[:8]}: {e}, including anyway")
                # Include document if check fails (better to try than skip)
                documents_with_chunks.append(doc)
        
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

### top_k (OPTIONAL, default: 20)
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


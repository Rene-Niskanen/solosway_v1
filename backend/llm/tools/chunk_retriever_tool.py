"""
Tool for Level 2 retrieval: Finding relevant chunks within documents.

This tool searches chunk-level embeddings within specific documents to find the most
relevant text segments. The agent should use this AFTER retrieve_documents().

Uses vector similarity search on chunks, scoped to documents selected in Level 1.
Implements global reranking to prevent context explosion (selects top 8-15 chunks total).
"""

from typing import List, Dict, Optional, Literal
import logging
from pydantic import BaseModel, Field
from langchain_core.tools import StructuredTool
from backend.services.supabase_client_factory import get_supabase_client
from backend.services.local_embedding_service import get_default_service

logger = logging.getLogger(__name__)


class ChunkRetrievalInput(BaseModel):
    """Input schema for chunk retrieval tool - simplified for Golden Path RAG."""
    query: str = Field(description="User query to find relevant chunks")
    document_ids: List[str] = Field(
        description="List of document IDs from Level 1 retrieval (retrieve_documents)"
    )
    business_id: Optional[str] = Field(
        None,
        description="Optional business UUID to filter results (for multi-tenancy)"
    )


def retrieve_chunks(
    query: str,
    document_ids: List[str],
    business_id: Optional[str] = None
) -> List[Dict]:
    """
    Retrieve relevant chunks within selected documents - Smart retrieval layer.
    
    This is Level 2 retrieval - searches chunks ONLY within the specified documents.
    Use this AFTER retrieve_documents().
    
    All intelligence happens here:
    - Heuristic query profile detection (fact/explanation/summary)
    - Adaptive top_k, min_score, per_doc_limit based on query type
    - Hybrid search (vector + keyword)
    - Global reranking
    
    Args:
        query: User query (e.g., "What is the market value?")
        document_ids: List of document IDs from Level 1 retrieval
        business_id: Optional business UUID to filter results (for multi-tenancy)
    
    Returns:
        List of chunks with metadata (see docstring for structure)
    """
    try:
        # 1. Validate input
        if not document_ids:
            logger.warning("No document IDs provided for chunk retrieval")
            return []
        
        if not isinstance(document_ids, list):
            logger.warning(f"document_ids must be a list, got {type(document_ids)}")
            return []
        
        if not query or not query.strip():
            logger.warning("Empty query provided to retrieve_chunks")
            return []
        
        # Validate document_ids are strings (UUIDs)
        valid_document_ids = []
        for doc_id in document_ids:
            if isinstance(doc_id, str) and doc_id.strip():
                valid_document_ids.append(doc_id.strip())
            else:
                logger.warning(f"Invalid document_id: {doc_id} (skipping)")
        
        if not valid_document_ids:
            logger.warning("No valid document IDs after validation")
            return []
        
        logger.debug(f"🔍 Chunk retrieval for {len(valid_document_ids)} documents, query: {query[:50]}...")
        
        # 2. HEURISTIC: Determine query profile (not LLM-driven)
        query_lower = query.lower()
        
        if any(word in query_lower for word in ['summarize', 'overview', 'all', 'everything', 'complete', 'entire', 'full']):
            query_profile = "summary"
            effective_top_k = 80
            effective_min_score = 0.2
            per_doc_limit = None  # Unlimited
            is_summarize_query = True
        elif any(word in query_lower for word in ['how', 'why', 'explain', 'what is', 'describe', 'tell me about']):
            query_profile = "explanation"
            effective_top_k = 25
            effective_min_score = 0.4
            per_doc_limit = 8
            is_summarize_query = False
        else:
            query_profile = "fact"
            effective_top_k = 8
            effective_min_score = 0.6
            per_doc_limit = 3
            is_summarize_query = False
        
        logger.info(f"[RETRIEVER] Query profile: {query_profile} (top_k={effective_top_k}, min_score={effective_min_score}, per_doc_limit={per_doc_limit})")
        
        # 3. Generate query embedding using Voyage AI (matches database embeddings)
        # CRITICAL: Chunk embeddings use Voyage AI (1024 dimensions) to match database schema
        # This matches the embeddings stored in document_vectors.embedding column
        import os
        use_voyage = os.environ.get('USE_VOYAGE_EMBEDDINGS', 'true').lower() == 'true'
        
        if use_voyage:
            try:
                from voyageai import Client
                voyage_api_key = os.environ.get('VOYAGE_API_KEY')
                if not voyage_api_key:
                    logger.error("VOYAGE_API_KEY not set, cannot generate chunk embedding")
                    return []
                
                voyage_client = Client(api_key=voyage_api_key)
                voyage_model = os.environ.get('VOYAGE_EMBEDDING_MODEL', 'voyage-law-2')
                
                response = voyage_client.embed(
                    texts=[query],
                    model=voyage_model,
                    input_type='query'  # Use 'query' for query embeddings
                )
                query_embedding = response.embeddings[0]
                logger.debug(f"✅ Using Voyage AI embedding ({len(query_embedding)} dimensions) for chunk search")
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
        
        logger.debug(f"   Query embedding dimension: {len(query_embedding)}")
        
        # 4. Get Supabase client
        supabase = get_supabase_client()
        
        # 5. Verify documents belong to business_id if provided (for multi-tenancy)
        if business_id:
            try:
                from uuid import UUID
                UUID(business_id)  # Validate UUID format
                # Check business_uuid for all documents
                doc_check = supabase.table('documents').select('id, business_uuid').in_('id', valid_document_ids).execute()
                business_map = {str(doc['id']): doc.get('business_uuid') for doc in doc_check.data or []}
                valid_document_ids = [doc_id for doc_id in valid_document_ids if str(business_map.get(doc_id)) == business_id]
                if not valid_document_ids:
                    logger.warning(f"   No documents found for business_id {business_id[:8]}... after filtering")
                    return []
                logger.debug(f"   Filtered to {len(valid_document_ids)} documents for business_id {business_id[:8]}...")
            except (ValueError, TypeError):
                logger.warning(f"   business_id '{business_id}' is not a valid UUID, skipping business filter")
        
        # 6. Search chunks within each document (HYBRID: Vector + Keyword)
        
        all_chunks = []
        document_metadata_cache = {}  # Cache document metadata (filename and classification_type)
        
        for doc_id in valid_document_ids:
            try:
                # 5a. For summarize queries: get ALL chunks directly (bypass vector search)
                # For normal queries: use vector similarity search
                if is_summarize_query:
                    # Summarize: Get ALL chunks directly from database, no similarity filtering
                    logger.debug(f"   Summarize query - getting ALL chunks for document: {doc_id[:8]}...")
                    direct_query = supabase.table('document_vectors').select(
                        'id, document_id, chunk_index, chunk_text, chunk_text_clean, page_number, metadata, bbox, blocks'
                    ).eq('document_id', doc_id).order('page_number').order('chunk_index').execute()
                    
                    vector_chunks = direct_query.data or []
                    # Add a dummy similarity score (1.0) for all chunks since we're not filtering by similarity
                    for chunk in vector_chunks:
                        chunk['similarity'] = 1.0
                    logger.info(f"   ✅ Retrieved {len(vector_chunks)} chunks directly from document {doc_id[:8]} (summarize mode)")
                    if vector_chunks:
                        # Debug: log first chunk structure
                        first_chunk = vector_chunks[0]
                        logger.info(f"   First chunk keys: {list(first_chunk.keys())}, has 'id': {'id' in first_chunk}, id value: {first_chunk.get('id', 'MISSING')}")
                        logger.info(f"   First chunk sample: {str(first_chunk)[:200]}...")
                    else:
                        logger.error(f"   ⚠️ CRITICAL: No chunks returned from Supabase for document {doc_id[:8]}!")
                else:
                    # Normal queries: Vector search within document using match_chunks() RPC
                    logger.debug(f"   Vector search for chunks in document: {doc_id[:8]}...")
                    
                    # More permissive threshold for initial retrieval
                    match_threshold = max(0.2, effective_min_score * 0.5)
                    match_count = effective_top_k * 2  # Get more candidates for reranking
                    
                    vector_response = supabase.rpc(
                        'match_chunks',
                        {
                            'query_embedding': query_embedding,
                            'target_document_id': doc_id,
                            'match_threshold': match_threshold,
                            'match_count': match_count
                        }
                    ).execute()
                    
                    vector_chunks = vector_response.data or []
                    logger.debug(f"   Vector search found {len(vector_chunks)} chunks in document {doc_id[:8]}")
                
                # 5b. Keyword search on chunk_text for exact matches (complements vector search)
                # SKIP keyword search for summarize queries (we already have all chunks)
                keyword_chunks = []
                if not is_summarize_query:
                    try:
                        query_lower = query.lower().strip()
                        query_words = [w for w in query_lower.split() if len(w) > 3]  # Only words longer than 3 chars
                        
                        keyword_query = supabase.table('document_vectors').select(
                            'id, document_id, chunk_index, chunk_text, chunk_text_clean, page_number, metadata, bbox, blocks'
                        ).eq('document_id', doc_id)
                        
                        # Search in chunk_text
                        or_conditions = [f'chunk_text.ilike.%{query_lower}%', f'chunk_text_clean.ilike.%{query_lower}%']
                        if len(query_words) > 1:
                            for word in query_words:
                                or_conditions.append(f'chunk_text.ilike.%{word}%')
                                or_conditions.append(f'chunk_text_clean.ilike.%{word}%')
                        
                        keyword_query = keyword_query.or_(','.join(or_conditions)).limit(effective_top_k).execute()
                        keyword_chunks = keyword_query.data or []
                        logger.debug(f"   Keyword search found {len(keyword_chunks)} chunks in document {doc_id[:8]}")
                    except Exception as kw_error:
                        logger.warning(f"   Keyword search failed for document {doc_id[:8]}: {kw_error}")
                        keyword_chunks = []
                
                # 5c. Combine vector and keyword results (deduplicate by chunk_id)
                chunks_dict = {}
                vector_chunk_ids = []  # Track chunk IDs from vector search for bbox lookup
                logger.info(f"   Processing {len(vector_chunks)} vector_chunks for document {doc_id[:8]}...")
                for idx, chunk in enumerate(vector_chunks):
                    chunk_id = str(chunk.get('id', ''))
                    if not chunk_id:
                        # For summarize queries, chunks might not have id in the response
                        # Use document_id + chunk_index as fallback identifier
                        chunk_id = f"{doc_id}_{chunk.get('chunk_index', idx)}"
                        logger.info(f"   Chunk {idx} missing 'id', using fallback: {chunk_id[:30]}...")
                    
                    # Track if bbox is missing (match_chunks RPC might not return it)
                    if not chunk.get('bbox') or not isinstance(chunk.get('bbox'), dict):
                        vector_chunk_ids.append(chunk_id)
                    
                    chunks_dict[chunk_id] = {
                        **chunk,
                        'similarity': float(chunk.get('similarity', 1.0))
                    }
                logger.info(f"   Added {len(chunks_dict)} chunks to chunks_dict for document {doc_id[:8]}")
                
                # 5c.1. Fetch bbox for vector chunks that don't have it (match_chunks RPC might not return bbox)
                if vector_chunk_ids:
                    try:
                        logger.debug(f"   Fetching bbox for {len(vector_chunk_ids)} vector chunks missing bbox...")
                        bbox_response = supabase.table('document_vectors').select(
                            'id, bbox, blocks'
                        ).in_('id', vector_chunk_ids).execute()
                        
                        for row in bbox_response.data or []:
                            chunk_id = str(row.get('id'))
                            bbox = row.get('bbox')
                            blocks = row.get('blocks', [])
                            
                            if chunk_id in chunks_dict:
                                # Prefer chunk-level bbox, fallback to first block's bbox
                                if isinstance(bbox, dict) and bbox.get('left') is not None:
                                    chunks_dict[chunk_id]['bbox'] = bbox
                                    logger.debug(f"   ✅ Added chunk-level bbox to {chunk_id[:8]}...")
                                elif blocks and isinstance(blocks, list) and len(blocks) > 0:
                                    first_block = blocks[0]
                                    if isinstance(first_block, dict):
                                        block_bbox = first_block.get('bbox')
                                        if isinstance(block_bbox, dict) and block_bbox.get('left') is not None:
                                            chunks_dict[chunk_id]['bbox'] = block_bbox
                                            logger.debug(f"   ✅ Added block-level bbox to {chunk_id[:8]}...")
                                else:
                                    logger.debug(f"   ⚠️ No valid bbox found for {chunk_id[:8]}... (bbox={bbox}, blocks={len(blocks) if blocks else 0})")
                    except Exception as bbox_fetch_error:
                        logger.warning(f"   Failed to fetch bbox for vector chunks: {bbox_fetch_error}")
                
                # Add keyword matches with quality-based scoring (skip for summarize queries)
                if not is_summarize_query and keyword_chunks:
                    query_lower = query.lower().strip()
                    query_words = [w for w in query_lower.split() if len(w) > 3]  # Only words longer than 3 chars
                    
                    for chunk in keyword_chunks:
                        chunk_id = str(chunk.get('id', ''))
                        chunk_text = (chunk.get('chunk_text', '') or chunk.get('chunk_text_clean', '') or '').lower()
                        
                        # Calculate keyword match quality
                        keyword_score = 0.0
                        if query_lower in chunk_text:
                            keyword_score = 0.7  # Exact match
                        elif any(word in chunk_text for word in query_words if len(word) > 3):
                            matched_words = sum(1 for word in query_words if word in chunk_text)
                            keyword_score = min(0.5, 0.1 * matched_words)  # 0.1 per word, max 0.5
                        else:
                            keyword_score = 0.2  # Fallback for any match
                        
                        if chunk_id in chunks_dict:
                            # Found in both: small boost (don't clamp!)
                            original_score = chunks_dict[chunk_id]['similarity']
                            chunks_dict[chunk_id]['similarity'] = original_score + (keyword_score * 0.1)  # Small boost, no clamping
                            logger.debug(f"   Chunk {chunk_id[:8]} found in both: vector={original_score:.3f}, boost={keyword_score * 0.1:.3f}")
                        else:
                            # Keyword-only: use keyword score (not hardcoded 0.6)
                            chunks_dict[chunk_id] = {
                                **chunk,
                                'similarity': keyword_score  # Quality-based, not hardcoded
                            }
                        logger.debug(f"   Chunk {chunk_id[:8]} keyword-only: score={keyword_score:.3f}")
                
                chunks = list(chunks_dict.values())
                logger.info(f"   Combined: {len(chunks)} unique chunks from document {doc_id[:8]} (vector: {len(vector_chunks)}, keyword: {len(keyword_chunks)}, chunks_dict: {len(chunks_dict)})")
                
                # CRITICAL: For summarize queries, ensure we have chunks
                if is_summarize_query and len(chunks) == 0 and len(vector_chunks) > 0:
                    logger.error(f"   ⚠️ CRITICAL: {len(vector_chunks)} chunks retrieved but 0 chunks in chunks_dict!")
                    if vector_chunks:
                        logger.error(f"   First chunk structure: {list(vector_chunks[0].keys())}")
                        logger.error(f"   First chunk 'id' value: {vector_chunks[0].get('id', 'MISSING')}")
                    # Fallback: add chunks directly even if they don't have proper IDs
                    for idx, chunk in enumerate(vector_chunks):
                        fallback_id = f"{doc_id}_fallback_{idx}"
                        chunks_dict[fallback_id] = {
                            **chunk,
                            'similarity': float(chunk.get('similarity', 1.0))
                        }
                    chunks = list(chunks_dict.values())
                    logger.warning(f"   Fallback: Added {len(chunks)} chunks using fallback IDs")
                
                # Get document metadata (cache to avoid repeated queries)
                if doc_id not in document_metadata_cache:
                    try:
                        doc_response = supabase.table('documents').select(
                            'id, original_filename, classification_type'
                        ).eq('id', doc_id).limit(1).execute()
                        
                        if doc_response.data and len(doc_response.data) > 0:
                            doc_data = doc_response.data[0]
                            document_metadata_cache[doc_id] = {
                                'filename': doc_data.get('original_filename', 'unknown'),
                                'classification_type': doc_data.get('classification_type', 'unknown')
                            }
                        else:
                            document_metadata_cache[doc_id] = {
                                'filename': 'unknown',
                                'classification_type': 'unknown'
                            }
                            logger.warning(f"   Document {doc_id[:8]} not found in database")
                    except Exception as e:
                        logger.warning(f"   Failed to fetch metadata for document {doc_id[:8]}: {e}")
                        document_metadata_cache[doc_id] = {
                            'filename': 'unknown',
                            'classification_type': 'unknown'
                        }
                
                doc_metadata = document_metadata_cache[doc_id]
                doc_filename = doc_metadata.get('filename', 'unknown') if isinstance(doc_metadata, dict) else doc_metadata
                doc_type = doc_metadata.get('classification_type', 'unknown') if isinstance(doc_metadata, dict) else 'unknown'
                
                # 5d. Format chunks with metadata
                logger.info(f"   Formatting {len(chunks)} chunks for document {doc_id[:8]}...")
                formatted_count = 0
                for chunk in chunks:
                    try:
                        chunk_metadata = chunk.get('metadata', {})
                        if isinstance(chunk_metadata, str):
                            # Handle case where metadata might be a JSON string
                            try:
                                import json
                                chunk_metadata = json.loads(chunk_metadata)
                            except:
                                chunk_metadata = {}
                        
                        # Get chunk_id - use fallback if missing
                        chunk_id = str(chunk.get('id', ''))
                        if not chunk_id:
                            chunk_id = f"{doc_id}_{chunk.get('chunk_index', formatted_count)}"
                        
                        # Ensure we have chunk text
                        chunk_text = chunk.get('chunk_text', '') or chunk.get('chunk_text_clean', '')
                        if not chunk_text:
                            logger.warning(f"   Skipping chunk {chunk_id[:20]}... - no chunk text")
                            continue
                        
                        chunk_bbox = chunk.get('bbox')
                        # Log bbox status for debugging
                        if not chunk_bbox or not isinstance(chunk_bbox, dict):
                            logger.debug(f"   ⚠️ Chunk {chunk_id[:8]}... has no bbox (type: {type(chunk_bbox)})")
                        
                        # Include blocks for block-level citation highlighting (more precise than chunk-level)
                        blocks = chunk.get('blocks', [])
                        
                        all_chunks.append({
                            'chunk_id': chunk_id,
                            'document_id': doc_id,
                            'document_filename': doc_filename,
                            'document_type': doc_type,  # Include document type for metadata
                            'chunk_index': chunk.get('chunk_index', formatted_count),
                            'chunk_text': chunk.get('chunk_text', ''),
                            'chunk_text_clean': chunk.get('chunk_text_clean', ''),
                            'page_number': chunk.get('page_number', 0),
                            'bbox': chunk_bbox,  # Chunk-level bbox (fallback)
                            'blocks': blocks,  # Block-level data for precise citation highlighting
                            'section_title': chunk_metadata.get('section_title') if isinstance(chunk_metadata, dict) else None,
                            'score': round(float(chunk.get('similarity', 1.0)), 4),
                            'metadata': chunk_metadata if isinstance(chunk_metadata, dict) else {}
                        })
                        formatted_count += 1
                    except Exception as format_error:
                        logger.error(f"   Failed to format chunk {formatted_count} from document {doc_id[:8]}: {format_error}", exc_info=True)
                        continue
                logger.info(f"   ✅ Formatted {formatted_count} chunks for document {doc_id[:8]} (total all_chunks: {len(all_chunks)})")
                
            except Exception as doc_error:
                # Continue to next document if one fails
                logger.warning(f"   Failed to retrieve chunks for document {doc_id[:8]}: {doc_error}")
                continue
        
        if not all_chunks:
            logger.warning(f"   No chunks found for query: {query[:50]}...")
            logger.warning(f"   Debug: is_summarize_query={is_summarize_query}, valid_document_ids={len(valid_document_ids)}")
            # For summarize queries, this should never happen if documents have chunks
            if is_summarize_query:
                logger.error(f"   ⚠️ CRITICAL: Summarize query returned 0 chunks for {len(valid_document_ids)} documents!")
                logger.error(f"   This suggests documents might not have chunks in the database.")
            return []
        
        # 6. Deduplicate chunks by chunk_id and ensure bbox is available
        seen_chunk_ids = set()
        unique_chunks = []
        chunks_needing_bbox = []  # Track chunks that need bbox lookup
        
        for chunk in all_chunks:
            chunk_id = chunk.get('chunk_id')
            if chunk_id and chunk_id not in seen_chunk_ids:
                seen_chunk_ids.add(chunk_id)
                # Check if bbox is missing - we'll fetch it later
                if not chunk.get('bbox') or not isinstance(chunk.get('bbox'), dict):
                    chunks_needing_bbox.append(chunk_id)
                unique_chunks.append(chunk)
            elif not chunk_id:
                # Include chunks without IDs (shouldn't happen, but handle gracefully)
                unique_chunks.append(chunk)
        
        # 6a. Fetch missing bbox data from database (batch lookup)
        if chunks_needing_bbox:
            try:
                logger.debug(f"   Fetching bbox data for {len(chunks_needing_bbox)} chunks missing bbox...")
                bbox_response = supabase.table('document_vectors').select(
                    'id, bbox, blocks'
                ).in_('id', chunks_needing_bbox).execute()
                
                # Create lookup map
                bbox_lookup = {}
                for row in bbox_response.data or []:
                    chunk_id = row.get('id')
                    bbox = row.get('bbox')
                    blocks = row.get('blocks', [])
                    
                    # Prefer chunk-level bbox, fallback to first block's bbox
                    if isinstance(bbox, dict) and bbox.get('left') is not None:
                        bbox_lookup[chunk_id] = bbox
                    elif blocks and isinstance(blocks, list) and len(blocks) > 0:
                        # Extract bbox from first block
                        first_block = blocks[0]
                        if isinstance(first_block, dict):
                            block_bbox = first_block.get('bbox')
                            if isinstance(block_bbox, dict) and block_bbox.get('left') is not None:
                                bbox_lookup[chunk_id] = block_bbox
                                logger.debug(f"   Using block bbox for chunk {chunk_id[:8]}...")
                
                # Update chunks with bbox data
                for chunk in unique_chunks:
                    chunk_id = chunk.get('chunk_id')
                    if chunk_id in bbox_lookup:
                        chunk['bbox'] = bbox_lookup[chunk_id]
                        logger.debug(f"   ✅ Added bbox to chunk {chunk_id[:8]}...")
            except Exception as bbox_error:
                logger.warning(f"   Failed to fetch bbox data: {bbox_error}")
                # Continue without bbox - citations will still work but without highlighting
        
        logger.debug(f"   Deduplicated: {len(all_chunks)} → {len(unique_chunks)} chunks")
        
        # 6.5. Global reranking: Re-compute vector similarity for all chunks
        # This ensures we're ranking by actual vector similarity, not clamped scores
        logger.debug(f"   Re-computing vector similarity for {len(unique_chunks)} chunks...")
        
        # Get all chunk embeddings in one query (more efficient)
        chunk_ids = [chunk['chunk_id'] for chunk in unique_chunks if chunk.get('chunk_id')]
        if chunk_ids:
            try:
                embeddings_response = supabase.table('document_vectors').select(
                    'id, embedding'
                ).in_('id', chunk_ids).execute()
                
                # Create mapping of chunk_id -> embedding
                chunk_embeddings = {}
                for row in embeddings_response.data or []:
                    embedding = row.get('embedding')
                    # Handle both list and string representations of embeddings
                    if isinstance(embedding, str):
                        # Parse string representation (PostgreSQL array format)
                        try:
                            import ast
                            embedding = ast.literal_eval(embedding)
                        except:
                            # Try JSON parsing
                            try:
                                import json
                                embedding = json.loads(embedding)
                            except:
                                logger.warning(f"   Could not parse embedding for chunk {row['id']}")
                                continue
                    chunk_embeddings[str(row['id'])] = embedding
                
                # Re-compute cosine similarity for all chunks
                import numpy as np
                query_vec = np.array(query_embedding, dtype=np.float32)
                
                reranked_count = 0
                for chunk in unique_chunks:
                    chunk_id = chunk.get('chunk_id')
                    if chunk_id and chunk_id in chunk_embeddings:
                        try:
                            chunk_vec = np.array(chunk_embeddings[chunk_id], dtype=np.float32)
                            # Cosine similarity
                            similarity = np.dot(query_vec, chunk_vec) / (np.linalg.norm(query_vec) * np.linalg.norm(chunk_vec))
                            chunk['score'] = float(similarity)  # Use raw vector similarity
                            reranked_count += 1
                        except Exception as vec_error:
                            logger.debug(f"   Failed to compute similarity for chunk {chunk_id[:8]}: {vec_error}")
                            # Keep existing score if vector computation fails
                    # If no embedding found, keep existing score (from keyword match)
                
                logger.debug(f"   Re-computed vector similarity for {reranked_count} chunks")
            except Exception as rerank_error:
                logger.warning(f"   Global reranking failed (non-fatal): {rerank_error}")
                # Continue with existing scores if reranking fails
        
        # 6.6. Per-document chunk limits: Prevent lower-scoring documents from dominating
        # 7. Group chunks by document and apply per-document limits based on query profile
        if document_ids and len(document_ids) > 1:
            chunks_by_doc = {}
            for chunk in unique_chunks:
                doc_id = chunk['document_id']
                if doc_id not in chunks_by_doc:
                    chunks_by_doc[doc_id] = []
                chunks_by_doc[doc_id].append(chunk)
            
            # Apply per-document limits based on query profile
            if per_doc_limit is not None:
                limited_chunks = []
                for i, doc_id in enumerate(document_ids):
                    doc_chunks = chunks_by_doc.get(doc_id, [])
                    # Sort chunks by score within this document
                    doc_chunks.sort(key=lambda x: x['score'], reverse=True)
                    
                    # Use per_doc_limit from query profile
                    # First doc gets full limit, subsequent docs get slightly less
                    if i == 0:
                        max_chunks = per_doc_limit
                    else:
                        max_chunks = max(1, int(per_doc_limit * 0.7))  # 70% for subsequent docs
                    
                    selected = doc_chunks[:max_chunks]
                    limited_chunks.extend(selected)
                    logger.debug(f"   Document {i+1} ({doc_id[:8]}...): {len(doc_chunks)} chunks → {len(selected)} selected (limit: {max_chunks})")
                
                unique_chunks = limited_chunks
                logger.debug(f"   Per-document limits applied: {len(limited_chunks)} chunks total (per_doc_limit={per_doc_limit})")
            else:
                # No per-doc limit (summary queries)
                logger.debug(f"   No per-doc limit (summary query) - keeping all {len(unique_chunks)} chunks")
        
        # 6.7. Document-level prioritization: Boost chunks from higher-scoring documents
        # Documents are passed in order from retrieve_docs (sorted by score), so first = highest score
        if document_ids and len(document_ids) > 1:
            doc_priority = {}
            for i, doc_id in enumerate(document_ids):
                # First document (highest score) gets weight 1.0, second gets 0.9, etc.
                # This ensures chunks from the most relevant document are prioritized
                doc_priority[doc_id] = 1.0 - (i * 0.15)  # 0.15 decrement per position
            
            # Apply document priority boost to chunk scores
            # INCREASED BOOST: Changed from 0.2 to 0.8 for stronger prioritization
            boosted_count = 0
            for chunk in unique_chunks:
                doc_id = chunk['document_id']
                priority_boost = doc_priority.get(doc_id, 0.5)  # Default 0.5 for unknown docs
                # Boost score by document priority (but don't exceed 1.0)
                # First document gets 1.8x boost (1.0 + 1.0 * 0.8), second gets 1.52x (1.0 + 0.85 * 0.8)
                original_score = chunk['score']
                chunk['score'] = min(1.0, original_score * (1.0 + priority_boost * 0.8))
                if priority_boost > 0.5:
                    boosted_count += 1
            
            if boosted_count > 0:
                logger.debug(f"   Applied document priority boost (0.8x) to {boosted_count} chunks from top documents")
        
        # 7. Global sorting - depends on search_goal
        if is_summarize_query:
            # For summarize queries: sort by document order (page/chunk_index) for coherence
            unique_chunks.sort(key=lambda x: (
                x.get('document_id', ''),
                x.get('page_number', 0),
                x.get('chunk_index', 0)
            ))
        else:
            # For normal queries: sort by similarity score (descending)
            unique_chunks.sort(key=lambda x: x['score'], reverse=True)
        
        # 8. CRITICAL: Global reranking - select chunks with relative filtering
        # SPECIAL CASE: For "summarize" queries, return ALL chunks (no filtering)
        if is_summarize_query:
            # For summarize queries: return ALL chunks, sorted by page/chunk_index for natural document order
            final_chunks = unique_chunks
            logger.debug(f"   Summarize query - returning ALL {len(final_chunks)} chunks (no filtering)")
        else:
            # Normal queries: select top 8-15 chunks total with relative filtering
            # This prevents context explosion (20 docs × 5 chunks = 100 chunks is too much)
            # Industry standard: Retrieve top-k per doc, then rerank globally, select final 8-15 chunks
            
            # Relative thresholding: Only filter if there's a clear quality gap
            if len(unique_chunks) > 0:
                top_score = unique_chunks[0]['score']
                # Only filter if top score is significantly above threshold AND there's a quality gap
                if top_score > effective_min_score * 1.5:  # Top score is well above threshold
                    # Filter out chunks that are much worse than the best
                    quality_gap = top_score - effective_min_score
                    final_chunks = [c for c in unique_chunks if c['score'] >= (top_score - quality_gap * 0.5)]
                    # Limit to top 15 regardless
                    final_chunks = final_chunks[:15]
                    logger.debug(f"   Relative filtering: {len(unique_chunks)} → {len(final_chunks)} chunks (top_score={top_score:.3f}, gap={quality_gap:.3f})")
                else:
                    # No clear quality gap - return top chunks (relative ranking is what matters)
                    final_chunks = unique_chunks[:15]
                    logger.debug(f"   No quality gap detected, returning top {len(final_chunks)} chunks")
            else:
                final_chunks = []
        
        logger.info(
            f"✅ Retrieved {len(final_chunks)} chunks from {len(valid_document_ids)} documents "
            f"(after global reranking from {len(unique_chunks)} total chunks)"
        )
        
        # 9. Log retrieval quality (Phase 2)
        log_retrieval_quality(query, valid_document_ids, final_chunks, query_profile)
        
        # 10. Optional: Fallback widening if no results for fact queries
        if not final_chunks and query_profile == "fact":
            logger.warning("[RETRIEVER] No results for fact query, trying with lower threshold...")
            effective_min_score = 0.4
            # Retry with lower threshold (would need to re-run search, but for now just log)
            logger.warning("[RETRIEVER] Fallback widening not yet implemented - returning empty")
        
        return final_chunks
        
    except Exception as e:
        logger.error(f"Chunk retrieval failed: {e}")
        import traceback
        logger.debug(traceback.format_exc())
        return []


def log_retrieval_quality(
    query: str,
    document_ids: List[str],
    result: List[Dict],
    query_profile: str
):
    """Log retrieval quality metrics for debugging (Phase 2)."""
    logger.info(f"[RETRIEVAL_QUALITY] Query: '{query[:50]}...'")
    logger.info(f"[RETRIEVAL_QUALITY] Profile: {query_profile}")
    logger.info(f"[RETRIEVAL_QUALITY] Docs searched: {len(document_ids)}")
    logger.info(f"[RETRIEVAL_QUALITY] Chunks returned: {len(result)}")
    
    if result:
        scores = [chunk.get('score', 0) for chunk in result if chunk.get('score')]
        if scores:
            logger.info(f"[RETRIEVAL_QUALITY] Score range: {min(scores):.3f} - {max(scores):.3f}")
            logger.info(f"[RETRIEVAL_QUALITY] Score avg: {sum(scores)/len(scores):.3f}")
        
        # Coverage per document
        doc_coverage = {}
        for chunk in result:
            doc_id = chunk.get('document_id', 'unknown')
            doc_coverage[doc_id] = doc_coverage.get(doc_id, 0) + 1
        logger.info(f"[RETRIEVAL_QUALITY] Chunks per doc: {dict(list(doc_coverage.items())[:5])}")  # Show first 5
    else:
        logger.warning("[RETRIEVAL_QUALITY] ⚠️ NO CHUNKS RETURNED - retrieval failed")


def create_chunk_retrieval_tool() -> StructuredTool:
    """
    Create a LangChain StructuredTool for chunk retrieval.
    
    This tool is designed to be used by the agent AFTER retrieve_documents().
    The agent should first find relevant documents, then use this tool to find
    specific chunks within those documents.
    
    Returns:
        LangChain StructuredTool instance
    """
    tool_description = """
## PURPOSE
Retrieves relevant text chunks within specified documents using vector similarity search.

This is Level 2 retrieval - finds chunks within documents. Use this AFTER retrieve_documents().

## WHEN TO USE
- After you have document IDs from retrieve_documents()
- When you need to find specific text segments within documents
- To get detailed information from selected documents

## HOW IT WORKS
1. Searches chunk-level embeddings within each specified document
2. Collects chunks from all documents
3. Sorts globally by similarity score (not per document)
4. Reranks and selects top 8-15 chunks total (prevents context explosion)

## PARAMETERS

### query (REQUIRED)
- The user's query/question
- Example: "What is the market value of the property?"
- Example: "What are the key features mentioned?"

### document_ids (REQUIRED)
- List of document IDs from retrieve_documents() (Level 1 retrieval)
- Example: ["uuid1", "uuid2", "uuid3"]
- Must be a non-empty list
- These are the documents you want to search within

**NOTE**: The retriever automatically determines optimal parameters based on query type:
- Fact queries: 8 chunks, 0.6 threshold
- Explanation queries: 25 chunks, 0.4 threshold  
- Summary queries: 80 chunks, 0.2 threshold

## RETURN VALUE
List of chunks with:
- chunk_id: UUID of the chunk
- document_id: UUID of the parent document
- document_filename: Original filename of the document
- chunk_index: Index of the chunk within the document
- chunk_text: Raw chunk text
- chunk_text_clean: Cleaned chunk text
- page_number: Page number where chunk appears
- section_title: Section title (if available)
- score: Similarity score (0.0-1.0)
- metadata: Additional chunk metadata

## EXAMPLES

### Example 1: Basic Usage
1. First call: retrieve_documents(query="property valuation")
   → Returns: [{"document_id": "uuid1", ...}, {"document_id": "uuid2", ...}]

2. Then call: retrieve_chunks(
       query="What is the market value?",
       document_ids=["uuid1", "uuid2"]
   )
   → Returns: List of relevant chunks from those documents

### Example 2: Multi-Document Query
1. First: retrieve_documents(
       query="valuation reports",
       query_type="broad"
   )
   → Returns: Documents ranked by relevance to valuation reports

2. Then: retrieve_chunks(
       query="What is the assessed value?",
       document_ids=[doc["document_id"] for doc in documents]
   )
   → Returns: Chunks from valuation reports

### Example 3: Simple Usage
retrieve_chunks(
    query="property features",
    document_ids=["uuid1", "uuid2"]
)
# The retriever automatically determines optimal parameters based on query type

## IMPORTANT NOTES
- This tool searches WITHIN specified documents only (document scoping)
- Final result is limited to 8-15 chunks total (global reranking prevents context explosion)
- Chunks are sorted globally by score, not per document
- Use retrieve_documents() FIRST to get document_ids
- Chunks include both raw and cleaned text for flexibility
- Metadata (page_number, section_title) helps provide context
"""
    
    return StructuredTool.from_function(
        func=retrieve_chunks,
        name="retrieve_chunks",
        description=tool_description,
        args_schema=ChunkRetrievalInput
    )


"""
Vector Service for Supabase with pgvector
"""
import os
import logging
import re
from typing import Dict, Any, List, Optional
import openai
from supabase import Client
import uuid
from datetime import datetime
import asyncio

# Anthropic is optional - only needed for contextual retrieval
try:
    import anthropic  # type: ignore
    ANTHROPIC_AVAILABLE = True
except ImportError:
    anthropic = None
    ANTHROPIC_AVAILABLE = False

from .supabase_client_factory import get_supabase_client
from backend.utils.bbox import ensure_bbox_dict

logger = logging.getLogger(__name__)

PRICE_SIGNAL_PATTERN = re.compile(
    r'(?:£|\$|€)\s*\d[\d,\.]*(?:\s*(?:million|bn|billion|m))?|\bmarket value\b|\bvaluation figure\b|\bsale price\b|\basking price\b|\bopinion of value\b',
    re.IGNORECASE,
)


def _contains_price_signal(text: Optional[str]) -> bool:
    if not text:
        return False
    return bool(PRICE_SIGNAL_PATTERN.search(text))

class SupabaseVectorService:
    """Service for managing vector embeddings in Supabase with pgvector"""
    
    def __init__(self):
        self.supabase: Client = get_supabase_client()
        
        # Initialize OpenAI for embeddings
        self.openai_api_key = os.environ.get('OPENAI_API_KEY')
        if not self.openai_api_key:
            raise ValueError("OPENAI_API_KEY environment variable is required")
        
        openai.api_key = self.openai_api_key
        # Using text-embedding-3-small for speed + HNSW compatibility (1536 dimensions)
        self.embedding_model = "text-embedding-3-small"
        
        # Initialize Anthropic for contextual retrieval (async client for parallel processing)
        self.anthropic_api_key = os.environ.get('ANTHROPIC_API_KEY')
        if ANTHROPIC_AVAILABLE and self.anthropic_api_key:
            self.anthropic_client = anthropic.AsyncAnthropic(api_key=self.anthropic_api_key)
            self.use_contextual_retrieval = True
            logger.info("Contextual Retrieval enabled (Anthropic - Async)")
        else:
            self.anthropic_client = None
            self.use_contextual_retrieval = False
            if not ANTHROPIC_AVAILABLE:
                logger.warning("anthropic module not installed - Contextual Retrieval disabled")
            else:
                logger.warning("ANTHROPIC_API_KEY not set - Contextual Retrieval disabled")
        
        # Table names
        self.document_vectors_table = "document_vectors"
        self.property_vectors_table = "property_vectors"
    
    def create_embeddings(self, text_chunks: List[str]) -> List[List[float]]:
        """
        Generate embeddings using OpenAI
        
        Args:
            text_chunks: List of text chunks to embed
            
        Returns:
            List of embedding vectors
        """
        try:
            if not text_chunks:
                return []
            
            # OpenAI has a limit of 8192 tokens per request
            # We'll process in batches of 100 chunks to be safe
            batch_size = 100
            all_embeddings = []
            
            for i in range(0, len(text_chunks), batch_size):
                batch = text_chunks[i:i + batch_size]
                
                response = openai.embeddings.create(
                    model=self.embedding_model,
                    input=batch
                )
                
                batch_embeddings = [item.embedding for item in response.data]
                all_embeddings.extend(batch_embeddings)
            
            return all_embeddings
            
        except Exception as e:
            logger.error(f"Error creating embeddings: {e}")
            raise
    
    def chunk_text(self, text: str, chunk_size: int = 1200, overlap: int = 180) -> List[str]:
        """
        Split text into overlapping chunks with intelligent boundary detection.
        Improved overlap (180 chars, 15% of chunk size) prevents context loss at boundaries.
        
        Args:
            text: Text to chunk
            chunk_size: Target chunk size in characters (default 1200)
            overlap: Character overlap between chunks (default 180, 15% of chunk size)
            
        Returns:
            List of text chunks
        """
        if not text:
            return []
        
        # Clean text
        text = text.strip()
        
        if len(text) <= chunk_size:
            return [text]
        
        chunks = []
        start = 0
        
        while start < len(text):
            # Extract chunk
            end = start + chunk_size
            chunk = text[start:end]
            
            # Try to break at sentence boundary if possible (better context preservation)
            if end < len(text):
                # Look for sentence endings within last 150 chars of chunk
                search_start = max(0, len(chunk) - 200)
                
                # Priority order: period, newline, semicolon, comma, space
                last_period = chunk.rfind('. ', search_start)
                last_newline = chunk.rfind('\n', search_start)
                last_semicolon = chunk.rfind('; ', search_start)
                last_comma = chunk.rfind(', ', search_start)
                last_space = chunk.rfind(' ', search_start)
                
                # Use the best break point (prefer sentence endings)
                break_point = max(last_period, last_newline, last_semicolon)
                
                if break_point > search_start:
                    # Found good sentence boundary
                    chunk = chunk[:break_point + 1]
                    end = start + break_point + 1
                elif last_comma > search_start:
                    # Fall back to comma
                    chunk = chunk[:last_comma + 1]
                    end = start + last_comma + 1
                elif last_space > search_start:
                    # Fall back to word boundary
                    chunk = chunk[:last_space]
                    end = start + last_space
            
            chunk = chunk.strip()
            if chunk:
                chunks.append(chunk)
            
            # Move start forward with overlap
            start = end - overlap
            
            # Prevent infinite loop
            if start + overlap >= len(text):
                break
        
        logger.debug(f"Chunked {len(text)} chars into {len(chunks)} overlapping chunks (overlap={overlap})")
        return chunks
    
    def enrich_chunk_for_embedding(self, chunk_text: str, metadata: Dict[str, Any]) -> str:
        """
        Enhance chunk with structured metadata for better semantic search.
        Real estate documents benefit from explicit property/document context.
        
        This dramatically improves retrieval accuracy by giving embeddings
        more context about what the chunk relates to.
        
        Args:
            chunk_text: Original chunk text
            metadata: Document/chunk metadata (may include 'party_names' dict)
            
        Returns:
            Enhanced text with metadata context
        """
        enriched_parts = []
        
        # Prepend party names if available (CRITICAL for name-based queries)
        party_names = metadata.get('party_names', {})
        if party_names:
            name_parts = []
            if valuer := party_names.get('valuer'):
                name_parts.append(f"Valuer: {valuer}")
            if seller := party_names.get('seller'):
                name_parts.append(f"Seller: {seller}")
            if buyer := party_names.get('buyer'):
                name_parts.append(f"Buyer: {buyer}")
            if agent := party_names.get('estate_agent'):
                name_parts.append(f"Estate Agent: {agent}")
            
            if name_parts:
                enriched_parts.append(" | ".join(name_parts))
        
        # Add the actual chunk text
        enriched_parts.append(chunk_text)
        
        # Add document type context (helps distinguish appraisals from inspections, etc.)
        if doc_type := metadata.get('classification_type'):
            doc_type_clean = doc_type.replace('_', ' ').title()
            enriched_parts.append(f"Document Type: {doc_type_clean}")
        
        # Add property address if available (critical for property-specific queries)
        if address := metadata.get('property_address'):
            address_clean = address.strip().replace('\n', ', ')
            enriched_parts.append(f"Property: {address_clean}")
        
        # Add filename context (often contains property name or identifier)
        if filename := metadata.get('original_filename'):
            # Extract readable name from filename
            name_clean = filename.replace('_', ' ').replace('.pdf', '').replace('.PDF', '')
            enriched_parts.append(f"File: {name_clean}")
        
        # Join parts with newlines
        enriched_text = "\n".join(enriched_parts)
        
        # Normalize terminology for consistency
        enriched_text = self._normalize_real_estate_terms(enriched_text)
        
        return enriched_text
    
    def _normalize_real_estate_terms(self, text: str) -> str:
        """
        Standardize common real estate terminology for better matching.
        Variations like '5 bd', '5 bedroom', '5BR' all become '5 bedroom'.
        
        Args:
            text: Text to normalize
            
        Returns:
            Normalized text
        """
        import re
        
        # Standardize area/size units
        text = re.sub(r'(\d+)\s*sq\.?\s*ft\.?', r'\1 sqft', text, flags=re.IGNORECASE)
        text = re.sub(r'(\d+)\s*square\s+feet', r'\1 sqft', text, flags=re.IGNORECASE)
        text = re.sub(r'(\d+)\s*sqm', r'\1 square meters', text, flags=re.IGNORECASE)
        
        # Standardize room counts
        text = re.sub(r'(\d+)\s*bed(?:room)?s?', r'\1 bedroom', text, flags=re.IGNORECASE)
        text = re.sub(r'(\d+)\s*bath(?:room)?s?', r'\1 bathroom', text, flags=re.IGNORECASE)
        text = re.sub(r'(\d+)br\b', r'\1 bedroom', text, flags=re.IGNORECASE)
        text = re.sub(r'(\d+)ba\b', r'\1 bathroom', text, flags=re.IGNORECASE)
        text = re.sub(r'(\d+)\s*bd\b', r'\1 bedroom', text, flags=re.IGNORECASE)
        
        # Standardize price notation
        text = re.sub(r'£\s*(\d{1,3}(?:,\d{3})*)', r'GBP \1', text)
        text = re.sub(r'\$\s*(\d{1,3}(?:,\d{3})*)', r'USD \1', text)
        
        return text
    
    def generate_chunk_context(self, chunk: str, document_metadata: Dict[str, Any]) -> str:
        """
        Generate contextual explanation for a chunk using Claude (Contextual Retrieval).
        Uses prompt caching to reduce costs.
        
        Args:
            chunk: The text chunk to contextualize
            document_metadata: Metadata about the document (type, property, filename, etc.)
            
        Returns:
            Concise context string (50-100 tokens) explaining the chunk's role in the document
        """
        if not self.use_contextual_retrieval or not self.anthropic_client:
            return ""  # Skip if Anthropic not configured
        
        try:
            # Extract metadata for context prompt
            doc_type = document_metadata.get('classification_type', 'Unknown')
            property_address = document_metadata.get('property_address', 'Unknown')
            filename = document_metadata.get('original_filename', 'Unknown')
            date = document_metadata.get('created_at', 'Unknown')
            
            # Build context generation prompt
            prompt = f"""
            <document_metadata>
            Document Type: {doc_type}
            Filename: {filename}
            Property Address: {property_address}
            Date: {date}
            </document_metadata>

            Here is the chunk we want to situate within the document:
            <chunk>
            {chunk}
            </chunk>

            Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else."""

            # Use Claude Haiku with prompt caching for cost efficiency
            # Prompt caching reduces costs by 90% for repeated document metadata
            response = self.anthropic_client.messages.create(
                model="claude-3-haiku-20240307",
                max_tokens=100,
                messages=[{"role": "user", "content": prompt}],
                system=[{
                    "type": "text",
                    "text": "You are an expert at providing concise context for document chunks in real estate documents.",
                    "cache_control": {"type": "ephemeral"}
                }]
            )
            
            context = response.content[0].text.strip()
            logger.debug(f"Generated context ({len(context)} chars): {context[:100]}...")
            
            return context
            
        except Exception as e:
            logger.warning(f"⚠️ Failed to generate chunk context: {e}")
            return ""  # Gracefully degrade to no context
    
    async def generate_chunk_context_async(self, chunk: str, document_metadata: Dict[str, Any]) -> str:
        """
        Async version of generate_chunk_context for parallel batch processing.
        
        Args:
            chunk: The text chunk to contextualize
            document_metadata: Metadata about the document
            
        Returns:
            Concise context string (50-100 tokens)
        """
        if not self.use_contextual_retrieval or not self.anthropic_client:
            return ""
        
        try:
            doc_type = document_metadata.get('classification_type', 'Unknown')
            property_address = document_metadata.get('property_address', 'Unknown')
            filename = document_metadata.get('original_filename', 'Unknown')
            date = document_metadata.get('created_at', 'Unknown')
            
            prompt = f"""
            <document_metadata>
            Document Type: {doc_type}
            Filename: {filename}
            Property Address: {property_address}
            Date: {date}
            </document_metadata>

            Here is the chunk we want to situate within the document:
            <chunk>
            {chunk}
            </chunk>

            Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else."""

            # Async API call
            response = await self.anthropic_client.messages.create(
                model="claude-3-haiku-20240307",
                max_tokens=100,
                messages=[{"role": "user", "content": prompt}],
                system=[{
                    "type": "text",
                    "text": "You are an expert at providing concise context for document chunks in real estate documents.",
                    "cache_control": {"type": "ephemeral"}
                }]
            )
            
            return response.content[0].text.strip()
            
        except Exception as e:
            logger.warning(f"⚠️ Failed to generate chunk context (async): {e}")
            return ""
    
    async def generate_contexts_batch(self, chunks: List[str], document_metadata: Dict[str, Any], batch_size: int = 5) -> List[str]:
        """
        Generate contexts for multiple chunks in parallel batches.
        
        This dramatically improves performance by making concurrent API calls.
        For 313 chunks: 30 minutes (sequential) → 3 minutes (batched async)!
        
        Args:
            chunks: List of text chunks
            document_metadata: Document metadata
            batch_size: Number of concurrent API calls (default 15)
            
        Returns:
            List of context strings (same order as input chunks)
        """
        if not self.use_contextual_retrieval:
            return [""] * len(chunks)
        
        all_contexts = []
        total_chunks = len(chunks)
        
        logger.info(f"🚀 Generating contextual explanations for {total_chunks} chunks (batch_size={batch_size})...")
        
        # Process in batches to avoid rate limits
        for i in range(0, total_chunks, batch_size):
            batch = chunks[i:i + batch_size]
            batch_num = (i // batch_size) + 1
            total_batches = (total_chunks + batch_size - 1) // batch_size
            
            logger.info(f"   Batch {batch_num}/{total_batches} ({len(batch)} chunks)...")
            
            # Create async tasks for this batch
            tasks = [
                self.generate_chunk_context_async(chunk, document_metadata)
                for chunk in batch
            ]
            
            # Execute batch in parallel
            batch_contexts = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Handle any exceptions
            processed_contexts = []
            for ctx in batch_contexts:
                if isinstance(ctx, Exception):
                    logger.warning(f"   Batch error: {ctx}")
                    processed_contexts.append("")
                else:
                    processed_contexts.append(ctx)
            
            all_contexts.extend(processed_contexts)
        
        successful = len([c for c in all_contexts if c])
        logger.info(f"✅ Generated {successful}/{total_chunks} contextual explanations")
        
        return all_contexts
    
    def _map_subchunk_to_blocks(
        self, 
        sub_chunk: str, 
        blocks: List[Dict], 
        parent_meta: Dict,
        subchunk_index: int = 0,
        total_subchunks: int = 1,
        original_chunk_content: str = None
    ) -> Dict:
        """
        Map a sub-chunk to the blocks it contains and extract bbox metadata.
        
        This ensures that when a large chunk is split, each sub-chunk gets
        the correct bbox and page number from the actual blocks it contains,
        rather than duplicating the parent chunk's bbox.
        
        Uses multiple matching strategies:
        1. Sequential block distribution (primary for large chunks)
        2. Word overlap matching
        3. Substring matching
        4. Fallback to first block
        
        Args:
            sub_chunk: The sub-chunk text (may be from embed or content)
            blocks: List of block metadata from the parent chunk
            parent_meta: Parent chunk metadata (fallback)
            subchunk_index: Index of this sub-chunk (0-based)
            total_subchunks: Total number of sub-chunks being created
            original_chunk_content: Original chunk content for better matching
            
        Returns:
            Dict with bbox metadata for the sub-chunk
        """
        if not blocks:
            # No blocks available, use parent metadata
            return parent_meta or {}
        
        # Strategy 1: Sequential block distribution (for large chunks with many blocks)
        # Distribute blocks evenly across sub-chunks based on position
        # This works well when we have many blocks (e.g., 1012 blocks → 280 sub-chunks)
        if total_subchunks > 1 and len(blocks) > 10:
            # Calculate which block range this sub-chunk should get
            blocks_per_subchunk = len(blocks) / total_subchunks
            start_block_idx = int(subchunk_index * blocks_per_subchunk)
            end_block_idx = int((subchunk_index + 1) * blocks_per_subchunk)
            
            # Ensure we get at least one block
            if end_block_idx <= start_block_idx:
                end_block_idx = start_block_idx + 1
            
            # Get the block for this sub-chunk (use first block in range)
            if start_block_idx < len(blocks):
                assigned_block = blocks[start_block_idx]
                block_bbox = ensure_bbox_dict(assigned_block.get('bbox'))
                
                if block_bbox:
                    logger.debug(f"Sub-chunk {subchunk_index}: Using block {start_block_idx} (page {block_bbox.get('page')})")
                    return {
                        'bbox': block_bbox,
                        'blocks': blocks[start_block_idx:end_block_idx] if end_block_idx <= len(blocks) else blocks[start_block_idx:],
                        'page': block_bbox.get('page')
                    }
        
        # Strategy 2: Try to find blocks by word overlap (for smaller chunks or when sequential fails)
        matching_blocks = []
        sub_chunk_lower = sub_chunk.lower().strip()
        sub_chunk_words = set(sub_chunk_lower.split())
        
        # Only consider words longer than 3 chars to avoid matching common words
        sub_chunk_significant_words = {w for w in sub_chunk_words if len(w) > 3}
        
        best_match_score = 0
        best_match_block = None
        
        for block in blocks:
            block_content = block.get('content', '')
            if not block_content:
                continue
            
            block_content_lower = block_content.lower().strip()
            block_words = set(block_content_lower.split())
            block_significant_words = {w for w in block_words if len(w) > 3}
            
            # Calculate word overlap with significant words
            if sub_chunk_significant_words and block_significant_words:
                overlap = len(sub_chunk_significant_words.intersection(block_significant_words))
                total_unique = len(sub_chunk_significant_words.union(block_significant_words))
                overlap_ratio = overlap / total_unique if total_unique > 0 else 0
                
                # Track the best match
                if overlap_ratio > best_match_score:
                    best_match_score = overlap_ratio
                    best_match_block = block
                
                # If significant overlap (>= 15% of significant words), consider it a match
                if overlap_ratio >= 0.15:
                    matching_blocks.append(block)
            
            # Also check for substring matches (for short blocks or partial matches)
            if len(block_content_lower) > 10:  # Only for substantial blocks
                if block_content_lower in sub_chunk_lower:
                    matching_blocks.append(block)
                elif len(sub_chunk_lower) > 20 and sub_chunk_lower[:50] in block_content_lower:
                    # Check if sub-chunk start appears in block
                    matching_blocks.append(block)
        
        # Use the best matching block's bbox
        selected_block = None
        if matching_blocks:
            # Prefer the block with highest overlap score
            if best_match_block and best_match_block in matching_blocks:
                selected_block = best_match_block
            else:
                selected_block = matching_blocks[0]
        elif best_match_block:
            # Use best match even if below threshold
            selected_block = best_match_block
        
        if selected_block:
            block_bbox = ensure_bbox_dict(selected_block.get('bbox'))
            if block_bbox:
                return {
                    'bbox': block_bbox,
                    'blocks': [selected_block],
                    'page': block_bbox.get('page')
                }
        
        # Strategy 2: Sequential assignment - distribute blocks across sub-chunks
        # This is a fallback when text matching fails
        # Estimate which block this sub-chunk might correspond to based on position
        # Since we don't have exact character positions, we'll use a simple heuristic:
        # If we have info about the chunk splitting, we could distribute blocks evenly
        # For now, use first block as fallback
        
        # Fallback: use first block's bbox if no matches found
        if blocks:
            first_block = blocks[0]
            block_bbox = ensure_bbox_dict(first_block.get('bbox'))
            if block_bbox:
                return {
                    'bbox': block_bbox,
                    'blocks': [first_block],
                    'page': block_bbox.get('page')
                }
        
        # Last resort: use parent metadata
        return parent_meta or {}
    
    def delete_document_vectors(self, document_id: str) -> bool:
        """
        Delete existing document vectors for a specific document
        This prevents duplicates when reprocessing documents.
        
        Args:
            document_id: Document UUID
            
        Returns:
            Success status
        """
        try:
            logger.info(f"Deleting existing document vectors for document {document_id}")
            
            result = self.supabase.table(self.document_vectors_table)\
                .delete()\
                .eq('document_id', document_id)\
                .execute()
            
            logger.info(f"Deleted document vectors for document {document_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error deleting document vectors: {e}")
            return False
    
    def store_document_vectors(
        self, 
        document_id: str, 
        chunks: List[str], 
        metadata: Dict[str, Any],
        chunk_metadata_list: Optional[List[Dict[str, Any]]] = None,  # NEW: Per-chunk metadata
        lazy_embedding: bool = False  # NEW: If True, store chunks without embeddings (lazy embedding)
    ) -> bool:
        """
        Store document vectors in Supabase with bbox metadata for each chunk
        
        Args:
            document_id: Document UUID
            chunks: List of text chunks - use the chunk.embed for embedding
            metadata: Metadata to store with vectors
            chunk_metadata_list: Optional list of the metadata dicts (one per chunk) with:
                - bbox: Chunk-level bbox (dict with left, top, width, height, page)
                - blocks: List of the block metadata (for detailed citation)
                - page: Primary page number
            lazy_embedding: If True, store chunks without embeddings (embedding_status='pending')
                           If False, generate embeddings immediately (default behavior)
        Returns:
            Success status
        """
        try:
            business_uuid = metadata.get('business_uuid') or metadata.get('business_id')
            if business_uuid:
                business_uuid = str(business_uuid)

            if not chunks:
                logger.warning("No chunks to store for document")
                return True
            
            # Delete existing vectors first to prevent duplicates
            self.delete_document_vectors(document_id)
            
            # Check if chunks need to be split BEFORE embedding (embedding model limit: 8192 tokens)
            # Estimate: ~4 characters per token, so 8192 tokens ≈ 32,768 chars
            MAX_CHUNK_SIZE = 30000  # ~7500 tokens, safe margin for 8192 token limit
            
            # Process chunks: split large ones, preserve metadata
            processed_chunks = []
            processed_metadata = []
            
            for i, (chunk, chunk_meta) in enumerate(zip(chunks, chunk_metadata_list or [None] * len(chunks))):
                if len(chunk) > MAX_CHUNK_SIZE:
                    # Split large chunk into smaller chunks BEFORE embedding
                    logger.info(f"⚠️ Large chunk detected ({len(chunk)} chars), splitting before embedding...")
                    sub_chunks = self.chunk_text(chunk, chunk_size=1200, overlap=180)
                    
                    # Get original blocks from metadata
                    original_blocks = chunk_meta.get('blocks', []) if chunk_meta else []
                    
                    # Get original chunk content for better block mapping
                    # The chunk might be embed text, but we need original content for matching
                    # We'll try to get it from parent_meta or use the chunk as-is
                    original_chunk_content = None
                    if chunk_meta:
                        # Try to get original content from stored chunks metadata
                        # This will be available if we stored chunks in metadata_json
                        original_chunk_content = chunk  # Use current chunk as fallback
                    
                    # Map each sub-chunk to its blocks and get bbox
                    # Pass chunk index to help with sequential distribution
                    for j, sub_chunk in enumerate(sub_chunks):
                        processed_chunks.append(sub_chunk)
                        
                        # Find which blocks this sub-chunk contains and extract their bbox
                        sub_chunk_meta = self._map_subchunk_to_blocks(
                            sub_chunk, 
                            original_blocks, 
                            chunk_meta,
                            subchunk_index=j,
                            total_subchunks=len(sub_chunks),
                            original_chunk_content=original_chunk_content
                        )
                        processed_metadata.append(sub_chunk_meta)
                    
                    logger.info(f"   Split chunk {i} into {len(sub_chunks)} sub-chunks with block-level bbox")
                else:
                    processed_chunks.append(chunk)
                    processed_metadata.append(chunk_meta or {})
            
            # Use processed chunks for embedding
            if len(processed_chunks) != len(chunks):
                logger.info(f"🔄 Processing {len(processed_chunks)} chunks for embedding (was {len(chunks)} original chunks)")
                chunks = processed_chunks
                chunk_metadata_list = processed_metadata
            
            # STEP 1: DOCUMENT-LEVEL CONTEXTUALIZATION (NEW - Replaces per-chunk)
            # Generate ONE document-level summary instead of per-chunk contexts
            # This reduces costs by 99.7% (1 API call vs 307 per document)
            document_summary = None
            chunk_contexts = []  # Will be empty for document-level approach
            
            if self.use_contextual_retrieval:
                try:
                    from .document_context_service import DocumentContextService
                    context_service = DocumentContextService()
                    
                    # Get full document text (from metadata or concatenate chunks)
                    full_document_text = metadata.get('parsed_text', '')
                    if not full_document_text:
                        # Fallback: concatenate all chunks
                        full_document_text = '\n\n'.join(chunks)
                    
                    # Generate ONE document-level summary
                    document_summary = context_service.generate_document_summary(
                        document_text=full_document_text,
                        metadata=metadata
                    )
                    
                    # Store document summary in documents table (if exists)
                    # Pass dict directly - Supabase will convert to JSONB automatically
                    try:
                        self.supabase.table('documents').update({
                            'document_summary': document_summary,  # Pass dict directly, not json.dumps()
                            'document_entities': document_summary.get('top_entities', []),
                            'document_tags': document_summary.get('document_tags', [])
                        }).eq('id', document_id).execute()
                        logger.info(f"✅ Stored document-level summary for {document_id}")
                    except Exception as e:
                        logger.warning(f"Could not store document summary in documents table: {e}")
                        # Continue anyway - summary will be prepended to chunks at query-time
                    
                    # Create empty contexts list (we'll prepend document summary at query-time)
                    chunk_contexts = [""] * len(chunks)
                    logger.info(
                        f"✅ Generated document-level context (1 API call vs {len(chunks)} per-chunk calls)"
                    )
                    
                except ImportError:
                    logger.warning("DocumentContextService not available, skipping document-level contextualization")
                    document_summary = None
                    chunk_contexts = [""] * len(chunks)
                except Exception as e:
                    logger.error(f"Document-level contextualization failed: {e}")
                    document_summary = None
                    chunk_contexts = [""] * len(chunks)
            else:
                # No contextualization - use original chunks
                document_summary = None
                chunk_contexts = [""] * len(chunks)
                logger.debug("Contextual Retrieval disabled - using original chunks")
            
            # For document-level contextualization, we DON'T prepend context to chunks during embedding
            # Instead, we'll prepend it at query-time in the retriever
            # So contextualized_chunks = original chunks
            contextualized_chunks = chunks
            
            # STEP 1.5: EXTRACT PARTY NAMES from document summary (generated by AI agent)
            # Party names are extracted by DocumentContextService using Claude
            # This uses the same API call as document summary generation (no extra cost)
            party_names = {}
            if document_summary and isinstance(document_summary, dict):
                # Extract party names from document summary (generated by AI)
                party_names = document_summary.get('party_names', {})
                logger.info(
                    f"✅ Extracted party names (via AI): valuer={party_names.get('valuer')}, "
                    f"seller={party_names.get('seller')}, buyer={party_names.get('buyer')}, "
                    f"estate_agent={party_names.get('estate_agent')}"
                )
            else:
                # If document summary not available, use empty party names
                logger.debug("Document summary not available, party names will be empty")
                party_names = {
                    'valuer': None,
                    'seller': None,
                    'buyer': None,
                    'estate_agent': None
                }
            
            # Add party names to metadata for enrichment
            metadata['party_names'] = party_names
            
            # STEP 2: ENRICHMENT - Add metadata context to contextualized chunks
            # This improves semantic search by giving more structured context
            enriched_chunks = []
            for i, chunk in enumerate(contextualized_chunks):
                # Get chunk-specific metadata if available
                chunk_meta = chunk_metadata_list[i] if chunk_metadata_list and i < len(chunk_metadata_list) else {}
                
                # Merge document metadata with chunk metadata
                full_metadata = {**metadata, **chunk_meta}
                
                # Enrich chunk with metadata for better embeddings
                enriched_text = self.enrich_chunk_for_embedding(chunk, full_metadata)
                enriched_chunks.append(enriched_text)
            
            logger.debug(f"Enriched {len(contextualized_chunks)} chunks with metadata context for embedding")
            
            # STEP 3: Generate embeddings (or skip for lazy embedding)
            if lazy_embedding:
                # Lazy embedding: Store chunks without embeddings, set status to 'pending'
                embeddings = [None] * len(chunks)
                logger.info(f"🚀 Lazy embedding mode: Storing {len(chunks)} chunks without embeddings (status='pending')")
            else:
                # Eager embedding: Generate embeddings immediately
                # NOTE: We embed enriched text but store ORIGINAL chunks + context in database
                embeddings = self.create_embeddings(enriched_chunks)
                
                if len(embeddings) != len(chunks):
                    raise ValueError(f"Embedding count mismatch: {len(embeddings)} vs {len(chunks)}")
            
            # Prepare records for insertion
            records = []
            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                chunk_meta = chunk_metadata_list[i] if chunk_metadata_list and i < len(chunk_metadata_list) else {}
                
                # Extract bbox for the insertion 
                chunk_bbox = ensure_bbox_dict(chunk_meta.get('bbox'))
                # Handle both dict and already-extracted page number
                if chunk_bbox:
                    if isinstance(chunk_bbox, dict):
                        chunk_page = chunk_bbox.get('page')
                    else:
                        chunk_page = chunk_meta.get('page')
                else:
                    chunk_page = chunk_meta.get('page')
                
                chunk_blocks = chunk_meta.get('blocks', [])
                
                # Get the context for this chunk (if contextualization was used)
                chunk_context = chunk_contexts[i] if i < len(chunk_contexts) else ""
                
                # Set embedding status based on lazy_embedding mode
                if lazy_embedding:
                    embedding_status = 'pending'
                    embedding_queued_at = datetime.utcnow().isoformat()
                    embedding_completed_at = None
                    embedding_error = None
                else:
                    embedding_status = 'embedded'
                    embedding_queued_at = None
                    embedding_completed_at = datetime.utcnow().isoformat()
                    embedding_error = None
                
                record = {
                    'id': str(uuid.uuid4()),
                    'document_id': document_id,
                    'property_id': metadata.get('property_id'),
                    'chunk_text': chunk,  # Original chunk (for display)
                    'chunk_context': chunk_context,  # Generated context (for reference)
                    'embedding': embedding,  # Embedding of contextualized+enriched chunk (or None for lazy)
                    'chunk_index': i,
                    'classification_type': metadata.get('classification_type'),
                    'address_hash': metadata.get('address_hash'),
                    'business_uuid': business_uuid,
                    'business_id': business_uuid,
                    'page_number': chunk_page,
                    'bbox': chunk_bbox,
                    'block_count': len(chunk_blocks),
                    'embedding_status': embedding_status,  # NEW: Track embedding status
                    'embedding_queued_at': embedding_queued_at,  # NEW: When embedding was queued
                    'embedding_completed_at': embedding_completed_at,  # NEW: When embedding completed
                    'embedding_error': embedding_error,  # NEW: Error message if embedding failed
                    'embedding_model': self.embedding_model if not lazy_embedding else None,  # NEW: Model used
                    'created_at': datetime.utcnow().isoformat()
                }
                records.append(record)
            
            # Insert into Supabase
            result = self.supabase.table(self.document_vectors_table).insert(records).execute()
            
            if result.data:
                logger.info(f"Stored {len(records)} document vectors with bbox metadata")
                return True
            else:
                logger.error(f"Failed to store document vectors: {result}")
                return False
                
        except Exception as e:
            logger.error(f"Error storing document vectors: {e}")
            return False
    
    def store_property_vectors(self, property_id: str, property_text: str, metadata: Dict[str, Any]) -> bool:
        """
        Store property vectors in Supabase
        
        Args:
            property_id: Property UUID
            property_text: Property description text
            metadata: Metadata to store with vectors
            
        Returns:
            Success status
        """
        try:
            business_uuid = metadata.get('business_uuid') or metadata.get('business_id')
            if business_uuid:
                business_uuid = str(business_uuid)

            if not property_text:
                logger.warning("No property text to store")
                return True
            
            # Chunk the property text
            chunks = self.chunk_text(property_text)
            
            if not chunks:
                logger.warning("No chunks created from property text")
                return True
            
            # Generate embeddings
            embeddings = self.create_embeddings(chunks)
            
            if len(embeddings) != len(chunks):
                raise ValueError(f"Embedding count mismatch: {len(embeddings)} vs {len(chunks)}")
            
            # Prepare records for insertion
            records = []
            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                record = {
                    'id': str(uuid.uuid4()),
                    'property_id': property_id,
                    'property_description': property_text if i == 0 else '',  # Empty string, not None (NOT NULL constraint)
                    'chunk_text': chunk,
                    'embedding': embedding,
                    'chunk_index': i,
                    'address_hash': metadata.get('address_hash'),
                    # Fix: property_vectors table only has business_id (text), not business_uuid (uuid)
                    'business_id': str(business_uuid) if business_uuid else None,
                    'property_address': metadata.get('property_address'),
                    'source_document_id': str(metadata.get('source_document_id')) if metadata.get('source_document_id') else None,
                    'created_at': datetime.utcnow().isoformat()
                }
                records.append(record)
            

            logger.info(f"Inserting {len(records)} property vectors with source_document_id...")
            # Insert into Supabase
            result = self.supabase.table(self.property_vectors_table).insert(records).execute()
            
            if result.data:
                logger.info(f"Property vectors stored successfully")
                return True
            else:
                logger.error(f"Failed to store property vectors: {result}")
                if hasattr(result, 'error'):
                    logger.error(f"     Error details: {result.error}")
                return False
                
        except Exception as e:
            logger.error(f"Error storing property vectors: {e}")
            return False
    
    def delete_property_vectors_by_source(self, property_id: str, source_document_id: str) -> bool:
        """
        Delete existing property vectors for a specific property + document combination
        This prevents duplicates when reprocessing documents.
        
        Args:
            property_id: Property UUID
            source_document_id: Source document UUID
            
        Returns:
            Success status
        """
        try:
            logger.info(f"Deleting existing property vectors for property {property_id} from document {source_document_id}")
            
            result = self.supabase.table(self.property_vectors_table)\
                .delete()\
                .eq('property_id', property_id)\
                .eq('source_document_id', source_document_id)\
                .execute()
            
            logger.info(f"Deleted property vectors for property {property_id} from document {source_document_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error deleting property vectors: {e}")
            return False
    
    def search_document_vectors(self, query: str, business_id: str, limit: int = 10, similarity_threshold: float = 0.7) -> List[Dict[str, Any]]:
        """
        Search document vectors using semantic similarity
        
        Args:
            query: Search query
            business_id: Business identifier
            limit: Maximum results to return
            similarity_threshold: Minimum similarity score
            
        Returns:
            List of matching document chunks
        """
        try:
            # Generate embedding for query
            query_embeddings = self.create_embeddings([query])
            if not query_embeddings:
                return []
            
            query_embedding = query_embeddings[0]
            
            # Use pgvector cosine similarity search
            # This requires a custom SQL query in Supabase
            result = self.supabase.rpc('search_document_vectors', {
                'query_embedding': query_embedding,
                'filter_business_id': str(business_id) if business_id else None,
                'match_threshold': similarity_threshold,
                'match_count': limit
            }).execute()
            
            if result.data:
                # Found matching document vectors
                return result.data
            else:
                # No matching document vectors found
                return []
                
        except Exception as e:
            logger.error(f"Error searching document vectors: {e}")
            return []
    
    def fetch_price_chunks_for_document(self, document_id: str, max_rows: Optional[int] = None) -> List[Dict[str, Any]]:
        """
        Retrieve chunks that contain price/valuation keywords for a specific document.
        This supplements semantic search when users ask for market values.
        """
        try:
            query = (
                self.supabase.table(self.document_vectors_table)
                .select('chunk_index,page_number,chunk_text,bbox')
                .eq('document_id', document_id)
                .order('chunk_index')
            )
            result = query.execute()
            rows = result.data or []
            filtered: List[Dict[str, Any]] = [
                row for row in rows if _contains_price_signal(row.get('chunk_text'))
            ]
            if max_rows:
                filtered = filtered[:max_rows]
            logger.info(
                "[PRICE_CHUNKS] doc=%s fetched %d rows, %d matched price signals",
                document_id[:8],
                len(rows),
                len(filtered),
            )
            return filtered
        except Exception as exc:
            logger.warning("Failed to fetch price chunks for document %s: %s", document_id, exc)
            return []
    
    def search_property_vectors(self, query: str, business_id: str, limit: int = 10, similarity_threshold: float = 0.7) -> List[Dict[str, Any]]:
        """
        Search property vectors using semantic similarity
        
        Args:
            query: Search query
            business_id: Business identifier
            limit: Maximum results to return
            similarity_threshold: Minimum similarity score
            
        Returns:
            List of matching property chunks
        """
        try:
            # Generate embedding for query
            query_embeddings = self.create_embeddings([query])
            if not query_embeddings:
                return []
            
            query_embedding = query_embeddings[0]
            
            # Use pgvector cosine similarity search
            result = self.supabase.rpc('search_property_vectors', {
                'query_embedding': query_embedding,
                'business_uuid': str(business_id) if business_id else None,
                'match_threshold': similarity_threshold,
                'match_count': limit
            }).execute()
            
            if result.data:
                # Found matching property vectors
                return result.data
            else:
                # No matching property vectors found
                return []
                
        except Exception as e:
            logger.error(f"Error searching property vectors: {e}")
            return []
    
    def delete_document_vectors(self, document_id: str) -> bool:
        """
        Delete all vectors for a document
        
        Args:
            document_id: Document UUID
            
        Returns:
            Success status
        """
        try:
            result = self.supabase.table(self.document_vectors_table).delete().eq('document_id', document_id).execute()
            
            if result.data is not None:
                # Vectors deleted for document
                return True
            else:
                logger.error(f"Failed to delete vectors for document {document_id}")
                return False
                
        except Exception as e:
            logger.error(f"Error deleting document vectors: {e}")
            return False
    
    def delete_property_vectors(self, property_id: str) -> bool:
        """
        Delete all vectors for a property
        
        Args:
            property_id: Property UUID
            
        Returns:
            Success status
        """
        try:
            result = self.supabase.table(self.property_vectors_table).delete().eq('property_id', property_id).execute()
            
            if result.data is not None:
                # Vectors deleted for property
                return True
            else:
                logger.error(f"Failed to delete vectors for property {property_id}")
                return False
                
        except Exception as e:
            logger.error(f"Error deleting property vectors: {e}")
            return False

    def delete_property_vectors_by_source_document(self, document_id: str, property_id: Optional[str] = None) -> bool:
        """
        Delete property vectors that were generated from a specific source document.

        Tries to filter by a dedicated 'source_document_id' column if present. If the
        column does not exist in the table schema, this method will return False so
        callers can decide to fall back to broader deletion strategies.

        Args:
            document_id: Source document UUID
            property_id: Optional property UUID to further scope the deletion

        Returns:
            Success status
        """
        try:
            query = self.supabase.table(self.property_vectors_table).delete().eq('source_document_id', document_id)
            if property_id:
                query = query.eq('property_id', property_id)
            result = query.execute()
            # If the table supports the column and the operation executed, consider it success
            return result.data is not None
        except Exception as e:
            logger.warning(f"Property vector delete by source_document_id not completed (schema may lack column): {e}")
            return False
    
    def get_vector_statistics(self, business_id: str) -> Dict[str, Any]:
        """
        Get statistics about stored vectors
        
        Args:
            business_id: Business identifier
            
        Returns:
            Statistics dictionary
        """
        try:
            # Count document vectors
            doc_vector_count = self.supabase.table(self.document_vectors_table).select('id', count='exact').eq('business_uuid', str(business_id)).execute()
            
            # Count property vectors
            prop_vector_count = self.supabase.table(self.property_vectors_table).select('id', count='exact').eq('business_uuid', str(business_id)).execute()
            
            return {
                'document_vectors': doc_vector_count.count if doc_vector_count.count else 0,
                'property_vectors': prop_vector_count.count if prop_vector_count.count else 0,
                'total_vectors': (doc_vector_count.count or 0) + (prop_vector_count.count or 0)
            }
            
        except Exception as e:
            logger.error(f"Error getting vector statistics: {e}")
            return {}

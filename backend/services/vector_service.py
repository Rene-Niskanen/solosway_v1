"""
Vector Service for Supabase with pgvector
"""
import os
import logging
from typing import Dict, Any, List, Optional
import openai
from supabase import Client
import json
import uuid
from datetime import datetime
import anthropic
import asyncio

from .supabase_client_factory import get_supabase_client
from .text_cleaning_service import TextCleaningService
from .chunk_quality_service import ChunkQualityService
from .chunk_validation_service import ChunkValidationService
from .section_header_extractor import (
    extract_section_header_from_blocks,
    extract_keywords
)

logger = logging.getLogger(__name__)

class SupabaseVectorService:
    """Service for managing vector embeddings in Supabase with pgvector"""
    
    def __init__(self):
        self.supabase: Client = get_supabase_client()
        
        # Check if using Voyage AI or OpenAI
        use_voyage = os.environ.get('USE_VOYAGE_EMBEDDINGS', 'true').lower() == 'true'
        
        if use_voyage:
            # Initialize Voyage AI for embeddings
            self.voyage_api_key = os.environ.get('VOYAGE_API_KEY')
            if not self.voyage_api_key:
                raise ValueError("VOYAGE_API_KEY environment variable is required when USE_VOYAGE_EMBEDDINGS=true")
            
            try:
                from voyageai import Client
                self.voyage_client = Client(api_key=self.voyage_api_key)
                self.embedding_model = os.environ.get('VOYAGE_EMBEDDING_MODEL', 'voyage-law-2')
                self.use_voyage = True
                self.embedding_dimension = 1024  # Voyage-law-2 produces 1024-dim vectors
                logger.info(f"Using Voyage AI embeddings: {self.embedding_model} ({self.embedding_dimension} dimensions)")
            except ImportError:
                raise ImportError("voyageai package not installed. Run: pip install voyageai")
        else:
            # Initialize OpenAI for embeddings (fallback)
            self.openai_api_key = os.environ.get('OPENAI_API_KEY')
            if not self.openai_api_key:
                raise ValueError("OPENAI_API_KEY environment variable is required")
            
            openai.api_key = self.openai_api_key
            self.embedding_model = "text-embedding-3-small"
            self.use_voyage = False
            self.embedding_dimension = 1536  # OpenAI text-embedding-3-small produces 1536-dim vectors
            logger.info(f"Using OpenAI embeddings: {self.embedding_model} ({self.embedding_dimension} dimensions)")
        
        # Initialize Anthropic for contextual retrieval (async client for parallel processing)
        self.anthropic_api_key = os.environ.get('ANTHROPIC_API_KEY')
        if self.anthropic_api_key:
            self.anthropic_client = anthropic.AsyncAnthropic(api_key=self.anthropic_api_key)
            self.use_contextual_retrieval = True
            logger.info("Contextual Retrieval enabled (Anthropic - Async)")
        else:
            self.anthropic_client = None
            self.use_contextual_retrieval = False
            logger.warning("ANTHROPIC_API_KEY not set - Contextual Retrieval disabled")
        
        # Table names
        self.document_vectors_table = "document_vectors"
        self.property_vectors_table = "property_vectors"
    
    def create_embeddings(self, text_chunks: List[str]) -> List[List[float]]:
        """
        Generate embeddings using Voyage AI or OpenAI
        
        Args:
            text_chunks: List of text chunks to embed
            
        Returns:
            List of embedding vectors
        """
        try:
            if not text_chunks:
                return []
            
            if self.use_voyage:
                # Use Voyage AI
                # Voyage AI can handle larger batches, but we'll use 100 to be safe
                # For free accounts: 3 RPM limit, so we need to space out batches
                batch_size = 100
                all_embeddings = []
                import time
                
                for i in range(0, len(text_chunks), batch_size):
                    batch = text_chunks[i:i + batch_size]
                    
                    # Rate limiting: Wait 20 seconds between batches to stay under 3 RPM limit
                    # (3 requests per minute = 1 request every 20 seconds)
                    if i > 0:  # Don't delay first batch
                        wait_time = 20
                        logger.info(f"⏳ Rate limiting: waiting {wait_time}s before batch {i//batch_size + 1} ({len(batch)} chunks)")
                        time.sleep(wait_time)
                    
                    max_retries = 2
                    retry_delay = 60  # Wait 1 minute on rate limit error
                    
                    for attempt in range(max_retries):
                        try:
                            response = self.voyage_client.embed(
                                texts=batch,
                                model=self.embedding_model,
                                input_type='document'  # Use 'document' for chunk embeddings
                            )
                            
                            # Voyage AI returns embeddings directly in response.embeddings
                            batch_embeddings = response.embeddings
                            all_embeddings.extend(batch_embeddings)
                            break  # Success, exit retry loop
                            
                        except Exception as e:
                            error_msg = str(e)
                            # Check if it's a rate limit error
                            if "rate limit" in error_msg.lower() or "RPM" in error_msg or "TPM" in error_msg or "payment method" in error_msg.lower():
                                if attempt < max_retries - 1:
                                    logger.warning(f"⚠️ Voyage API rate limit hit (attempt {attempt + 1}/{max_retries}): {error_msg[:200]}")
                                    logger.info(f"⏳ Waiting {retry_delay}s before retry...")
                                    time.sleep(retry_delay)
                                else:
                                    logger.error(f"❌ Voyage API rate limit error after {max_retries} attempts: {error_msg[:200]}")
                                    raise
                            else:
                                # Not a rate limit error, re-raise immediately
                                raise
                
                logger.debug(f"Generated {len(all_embeddings)} embeddings using Voyage AI ({self.embedding_model})")
                return all_embeddings
            else:
                # Use OpenAI (existing code)
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
                
                logger.debug(f"Generated {len(all_embeddings)} embeddings using OpenAI ({self.embedding_model})")
                return all_embeddings
            
        except Exception as e:
            logger.error(f"Error creating embeddings: {e}")
            raise
    
    def _calculate_dynamic_overlap(self, text: str, chunk_size: int = 1200) -> int:
        """
        Calculate optimal overlap based on content density.
        
        Dynamic overlap strategy:
        - Dense content (technical, legal, long sentences): 25% overlap
          → More context needed to preserve meaning across boundaries
        - Normal content (average sentence length): 20% overlap
          → Balanced context preservation
        - Simple content (short sentences, lists): 15% overlap
          → Less context needed, can be more efficient
        
        This improves accuracy by ensuring critical information isn't lost
        when chunks are split, especially for complex documents.
        
        Args:
            text: Text to analyze
            chunk_size: Target chunk size in characters
            
        Returns:
            Optimal overlap in characters
        """
        if not text or len(text) < 100:
            # Too short to analyze, use default
            return int(chunk_size * 0.15)
        
        import re
        
        # Analyze content density by sentence length
        # Split by sentence endings (period, exclamation, question mark)
        sentences = re.split(r'[.!?]+\s+', text)
        sentences = [s.strip() for s in sentences if s.strip()]
        
        if not sentences:
            # No sentence boundaries found, use default
            return int(chunk_size * 0.15)
        
        # Calculate average sentence length
        avg_sentence_length = sum(len(s) for s in sentences) / len(sentences) if sentences else 0
        
        # Determine content density and calculate overlap
        # Dense content: long sentences (>100 chars avg) - technical, legal documents
        if avg_sentence_length > 100:
            overlap_percent = 0.25  # 25% overlap for maximum context preservation
            logger.debug(f"📊 Dense content detected (avg sentence: {avg_sentence_length:.1f} chars) → 25% overlap")
        # Normal content: average sentence length (60-100 chars)
        elif avg_sentence_length > 60:
            overlap_percent = 0.20  # 20% overlap for balanced preservation
            logger.debug(f"📊 Normal content detected (avg sentence: {avg_sentence_length:.1f} chars) → 20% overlap")
        # Simple content: short sentences (<60 chars) - lists, bullet points, simple text
        else:
            overlap_percent = 0.15  # 15% overlap for efficiency
            logger.debug(f"📊 Simple content detected (avg sentence: {avg_sentence_length:.1f} chars) → 15% overlap")
        
        overlap = int(chunk_size * overlap_percent)
        return overlap
    
    def chunk_text(self, text: str, chunk_size: int = 1200, overlap: int = None) -> List[str]:
        """
        Split text into overlapping chunks with intelligent boundary detection.
        
        NEW: Dynamic overlap calculation based on content density.
        - Dense content (technical, legal): 25% overlap
        - Normal content: 20% overlap  
        - Simple content (lists, bullet points): 15% overlap
        
        This adaptive approach improves accuracy by preserving more context
        for complex documents while remaining efficient for simple content.
        
        Args:
            text: Text to chunk
            chunk_size: Target chunk size in characters (default 1200)
            overlap: Character overlap between chunks. If None, calculated dynamically
                     based on content density. If provided, uses that value.
            
        Returns:
            List of text chunks
        """
        if not text:
            return []
        
        # Clean text
        text = text.strip()
        
        if len(text) <= chunk_size:
            return [text]
        
        # Calculate dynamic overlap if not provided
        if overlap is None:
            overlap = self._calculate_dynamic_overlap(text, chunk_size)
            overlap_percent = (overlap / chunk_size * 100) if chunk_size > 0 else 0
            logger.debug(f"📊 Dynamic overlap calculated: {overlap} chars ({overlap_percent:.1f}% of chunk size)")
        
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
        
        # Add the actual chunk text (already cleaned separately before this function is called)
        # NOTE: This function is now only for display/context enrichment, NOT for embedding
        # Cleaning happens separately in store_document_vectors() before embedding
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
    
    def clean_chunk_text(
        self, 
        chunk_text: str, 
        boilerplate_lines: Optional[List[Dict[str, Any]]] = None
    ) -> str:
        """
        Clean chunk text before embedding using TextCleaningService.
        
        This ensures only clean, semantic text is embedded, improving retrieval accuracy.
        
        Args:
            chunk_text: Raw chunk text to clean
            boilerplate_lines: Optional list of boilerplate lines to remove
            
        Returns:
            Clean text ready for embedding
        """
        if not hasattr(self, '_text_cleaning_service'):
            self._text_cleaning_service = TextCleaningService()
        
        return self._text_cleaning_service.clean_chunk_text(
            chunk_text, 
            boilerplate_lines=boilerplate_lines
        )
    
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
                block_bbox = assigned_block.get('bbox')
                
                if block_bbox:
                    if isinstance(block_bbox, dict):
                        logger.debug(f"Sub-chunk {subchunk_index}: Using block {start_block_idx} (page {block_bbox.get('page')})")
                        return {
                            'bbox': block_bbox,
                            'blocks': blocks[start_block_idx:end_block_idx] if end_block_idx <= len(blocks) else blocks[start_block_idx:],
                            'page': block_bbox.get('page')
                        }
                    else:
                        try:
                            import json
                            bbox_dict = json.loads(block_bbox) if isinstance(block_bbox, str) else block_bbox
                            if isinstance(bbox_dict, dict):
                                return {
                                    'bbox': bbox_dict,
                                    'blocks': blocks[start_block_idx:end_block_idx] if end_block_idx <= len(blocks) else blocks[start_block_idx:],
                                    'page': bbox_dict.get('page')
                                }
                        except:
                            pass
        
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
            block_bbox = selected_block.get('bbox')
            if block_bbox:
                # Ensure bbox is a dict
                if isinstance(block_bbox, dict):
                    return {
                        'bbox': block_bbox,
                        'blocks': [selected_block],
                        'page': block_bbox.get('page')
                    }
                else:
                    # Try to parse if it's a string
                    try:
                        import json
                        bbox_dict = json.loads(block_bbox) if isinstance(block_bbox, str) else block_bbox
                        return {
                            'bbox': bbox_dict,
                            'blocks': [selected_block],
                            'page': bbox_dict.get('page') if isinstance(bbox_dict, dict) else None
                        }
                    except:
                        pass
        
        # Strategy 2: Sequential assignment - distribute blocks across sub-chunks
        # This is a fallback when text matching fails
        # Estimate which block this sub-chunk might correspond to based on position
        # Since we don't have exact character positions, we'll use a simple heuristic:
        # If we have info about the chunk splitting, we could distribute blocks evenly
        # For now, use first block as fallback
        
        # Fallback: use first block's bbox if no matches found
        if blocks:
            first_block = blocks[0]
            block_bbox = first_block.get('bbox')
            if block_bbox:
                if isinstance(block_bbox, dict):
                    return {
                        'bbox': block_bbox,
                        'blocks': [first_block],
                        'page': block_bbox.get('page')
                    }
                else:
                    try:
                        import json
                        bbox_dict = json.loads(block_bbox) if isinstance(block_bbox, str) else block_bbox
                        return {
                            'bbox': bbox_dict,
                            'blocks': [first_block],
                            'page': bbox_dict.get('page') if isinstance(bbox_dict, dict) else None
                        }
                    except:
                        pass
        
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
            
            # Check if chunks need to be split BEFORE embedding
            # FIX: Reducto creates section-based chunks averaging 14k chars, which are too large for LLM processing
            # Target: 500-1000 tokens per chunk (2000-4000 chars) for optimal retrieval and LLM processing
            # Two-tier approach:
            # - WARNING threshold: 2000 chars (log warning but don't split)
            # - SPLIT threshold: 2500 chars (split into smaller chunks)
            MAX_CHUNK_SIZE = 2500  # ~625 tokens, optimal for LLM processing
            WARNING_CHUNK_SIZE = 2000  # ~500 tokens, warn but don't split
            
            # Process chunks: split large ones, preserve metadata
            processed_chunks = []
            processed_metadata = []
            
            # Track statistics for logging
            total_original_chunks = len(chunks)
            chunks_split = 0
            chunks_warned = 0
            total_subchunks_created = 0
            
            for i, (chunk, chunk_meta) in enumerate(zip(chunks, chunk_metadata_list or [None] * len(chunks))):
                chunk_size = len(chunk)
                
                # Two-tier validation: warn for large chunks, split for very large chunks
                if chunk_size > WARNING_CHUNK_SIZE and chunk_size <= MAX_CHUNK_SIZE:
                    chunks_warned += 1
                    logger.warning(
                        f"⚠️  Chunk {i} is large ({chunk_size:,} chars, ~{chunk_size//4:,} tokens) - "
                        f"consider splitting. Current threshold: {MAX_CHUNK_SIZE:,} chars"
                    )
                    # Don't split, but log for monitoring
                    processed_chunks.append(chunk)
                    processed_metadata.append(chunk_meta or {})
                
                elif chunk_size > MAX_CHUNK_SIZE:
                    # Split large chunk into smaller chunks BEFORE embedding
                    chunks_split += 1
                    logger.info(
                        f"🔪 Splitting chunk {i} ({chunk_size:,} chars, ~{chunk_size//4:,} tokens) "
                        f"into smaller sub-chunks (target: 1500 chars, ~375 tokens each)..."
                    )
                    
                    # Use dynamic overlap (None = auto-calculate based on content density)
                    # This preserves continuous context between chunks
                    # 1500 chars ≈ 375 tokens - optimal balance between context and processing
                    sub_chunks = self.chunk_text(chunk, chunk_size=1500, overlap=None)
                    total_subchunks_created += len(sub_chunks)
                    
                    logger.debug(
                        f"   Created {len(sub_chunks)} sub-chunks from chunk {i} "
                        f"(avg {sum(len(sc) for sc in sub_chunks) // len(sub_chunks):,} chars each)"
                    )
                    
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
                    
                    logger.info(
                        f"   ✅ Split chunk {i} into {len(sub_chunks)} sub-chunks with preserved bbox metadata "
                        f"(overlap maintained for continuous context)"
                    )
                else:
                    # Chunk is within acceptable size limits
                    processed_chunks.append(chunk)
                    processed_metadata.append(chunk_meta or {})
            
            # Log final statistics
            if chunks_split > 0 or chunks_warned > 0:
                logger.info(
                    f"📊 Chunk processing summary:\n"
                    f"   • Original chunks: {total_original_chunks}\n"
                    f"   • Chunks split: {chunks_split} → {total_subchunks_created} sub-chunks\n"
                    f"   • Chunks warned (large but not split): {chunks_warned}\n"
                    f"   • Final chunks for embedding: {len(processed_chunks)}\n"
                    f"   • Bbox metadata preserved: ✅ (all sub-chunks mapped to original blocks)"
                )
            
            # Use processed chunks for embedding
            if len(processed_chunks) != len(chunks):
                logger.info(
                    f"🔄 Processing {len(processed_chunks)} chunks for embedding "
                    f"(was {len(chunks)} original chunks, {chunks_split} were split)"
                )
                chunks = processed_chunks
                chunk_metadata_list = processed_metadata
            
            # STEP 1: DOCUMENT-LEVEL CONTEXTUALIZATION (NEW - Replaces per-chunk)
            # Generate ONE document-level summary instead of per-chunk contexts
            # This reduces costs by 99.7% (1 API call vs 307 per document)
            # NOTE: If lazy_embedding=True, context generation happens in background tasks
            #       (see backend/celery_tasks.py), so we skip it here
            document_summary = None
            chunk_contexts = []  # Will be empty for document-level approach
            
            # Skip synchronous context generation if lazy_embedding=True (handled by background tasks)
            if self.use_contextual_retrieval and not lazy_embedding:
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
                    # CRITICAL FIX: Use DocumentStorageService to MERGE instead of REPLACE
                    # This preserves existing Reducto data (reducto_chunks, reducto_job_id, bbox metadata)
                    try:
                        from .document_storage_service import DocumentStorageService
                        doc_storage = DocumentStorageService()
                        
                        # Merge AI-generated summary with existing Reducto data
                        # This preserves all reducto_* fields (chunks, job_id, bbox metadata)
                        success, error = doc_storage.update_document_summary(
                            document_id=document_id,
                            business_id=business_uuid,  # Use business_uuid from metadata
                            updates={
                                **document_summary,  # AI-generated summary fields
                                'document_entities': document_summary.get('top_entities', []),
                                'document_tags': document_summary.get('document_tags', [])
                            },
                            merge=True  # CRITICAL: Merge with existing reducto_* fields
                        )
                        
                        if success:
                            logger.info(f"✅ Stored document-level summary for {document_id} (merged with existing Reducto data)")
                        else:
                            logger.warning(f"Could not store document summary: {error}")
                            # Continue anyway - summary will be prepended to chunks at query-time
                    except Exception as e:
                        logger.warning(f"Could not store document summary in documents table: {e}")
                        import traceback
                        logger.debug(traceback.format_exc())
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
            
            # Add party names to metadata for enrichment (for display/context only)
            metadata['party_names'] = party_names
            
            # STEP 2: CLEAN RAW CHUNKS FIRST (before any enrichment)
            # CRITICAL: Clean the raw chunk text to remove HTML, Markdown, OCR artifacts, boilerplate
            # This ensures embeddings contain ONLY semantic content, not formatting noise
            boilerplate_lines = metadata.get('boilerplate_lines')
            
            cleaned_chunks = []
            for chunk in contextualized_chunks:
                # Clean the raw chunk text (removes HTML, markdown, OCR, boilerplate)
                cleaned = self.clean_chunk_text(
                    chunk,  # Raw chunk text from Reducto
                    boilerplate_lines=boilerplate_lines
                )
                cleaned_chunks.append(cleaned)
            
            logger.debug(f"Cleaned {len(cleaned_chunks)} raw chunks (removed HTML, Markdown, OCR artifacts)")
            
            # STEP 2.3: VALIDATE CLEANED CHUNKS
            # Validate cleaned chunks before embedding (guardrails)
            validation_service = ChunkValidationService(strict_mode=False)  # Set to True to reject invalid chunks
            validation_results = validation_service.validate_batch(cleaned_chunks)
            
            # Log validation summary
            valid_count = sum(1 for is_valid, _ in validation_results.values() if is_valid)
            invalid_count = len(validation_results) - valid_count
            
            if invalid_count > 0:
                logger.warning(f"⚠️ [VALIDATION] {invalid_count} chunks failed validation (will still be embedded)")
            else:
                logger.info(f"✅ [VALIDATION] All {len(cleaned_chunks)} chunks passed validation")
            
            # STEP 2.5: COMPUTE QUALITY SCORES
            # Compute quality scores for cleaned chunks
            quality_service = ChunkQualityService()
            quality_scores = []
            
            # Prepare metadata for quality scoring (extract boilerplate ratios if available)
            for i, cleaned_chunk in enumerate(cleaned_chunks):
                chunk_meta = chunk_metadata_list[i] if chunk_metadata_list and i < len(chunk_metadata_list) else {}
                
                # Calculate boilerplate ratio if we have boilerplate info
                quality_metadata = {}
                if metadata.get('boilerplate_lines'):
                    # Count boilerplate lines in this chunk
                    chunk_lines = cleaned_chunk.split('\n')
                    boilerplate_lines = metadata.get('boilerplate_lines', [])
                    boilerplate_texts = {bp.get('line', '').strip() for bp in boilerplate_lines if bp.get('line')}
                    
                    boilerplate_count = sum(1 for line in chunk_lines if line.strip() in boilerplate_texts)
                    total_lines = len([l for l in chunk_lines if l.strip()])
                    quality_metadata['boilerplate_ratio'] = boilerplate_count / total_lines if total_lines > 0 else 0
                
                score = quality_service.compute_quality_score(cleaned_chunk, quality_metadata)
                quality_scores.append(score)
            
            avg_score = sum(quality_scores) / len(quality_scores) if quality_scores else 0.0
            logger.info(f"📊 Computed quality scores: {len(quality_scores)} scores (avg: {avg_score:.2f})")
            
            # STEP 2.6: ENRICHMENT (for display/retrieval context only, NOT for embedding)
            # Generate enriched text for display purposes, but DO NOT embed it
            enriched_chunks_for_display = []
            for i, chunk in enumerate(contextualized_chunks):
                # Get chunk-specific metadata if available
                chunk_meta = chunk_metadata_list[i] if chunk_metadata_list and i < len(chunk_metadata_list) else {}
                
                # Merge document metadata with chunk metadata
                full_metadata = {**metadata, **chunk_meta}
                
                # Enrich chunk with metadata for display/context (NOT for embedding)
                enriched_text = self.enrich_chunk_for_embedding(chunk, full_metadata)
                enriched_chunks_for_display.append(enriched_text)
            
            logger.debug(f"Generated enriched text for {len(enriched_chunks_for_display)} chunks (display only)")
            
            # STEP 3: Generate embeddings (or skip for lazy embedding)
            if lazy_embedding:
                # Lazy embedding: Store chunks without embeddings, set status to 'pending'
                embeddings = [None] * len(chunks)
                logger.info(f"🚀 Lazy embedding mode: Storing {len(chunks)} chunks without embeddings (status='pending')")
            else:
                # Eager embedding: Generate embeddings immediately
                # CRITICAL: Embed ONLY cleaned text (no enrichment, no metadata prepending)
                embeddings = self.create_embeddings(cleaned_chunks)
                
                if len(embeddings) != len(chunks):
                    raise ValueError(f"Embedding count mismatch: {len(embeddings)} vs {len(chunks)}")
            
            # Prepare records for insertion
            records = []
            
            # Phase 1 & 2: Track current section header for propagation
            current_section_header = None
            current_section_title = None
            current_section_level = None
            
            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                chunk_meta = chunk_metadata_list[i] if chunk_metadata_list and i < len(chunk_metadata_list) else {}
                
                # Extract bbox following Reducto's bbox format specification:
                # {left, top, width, height, page, original_page}
                # JSONB columns expect dict directly, NOT json string
                chunk_bbox = chunk_meta.get('bbox')
                
                # Extract page number - prefer original_page per Reducto recommendation
                # Reducto recommends using original_page for referencing source document pages
                chunk_page = None
                if chunk_bbox and isinstance(chunk_bbox, dict):
                    # Prefer original_page (recommended by Reducto for source references)
                    chunk_page = chunk_bbox.get('original_page') or chunk_bbox.get('page')
                    if chunk_page is not None:
                        try:
                            chunk_page = int(chunk_page)
                        except (ValueError, TypeError):
                            chunk_page = None
                
                # Fallback to extracted page from chunk_meta if bbox doesn't have it
                if chunk_page is None:
                    chunk_page = chunk_meta.get('page')
                    if chunk_page is not None:
                        try:
                            chunk_page = int(chunk_page)
                        except (ValueError, TypeError):
                            chunk_page = None
                
                chunk_blocks = chunk_meta.get('blocks', [])
                
                # PHASE 1: Extract section header from blocks array (primary source)
                section_header_info = None
                if chunk_blocks and isinstance(chunk_blocks, list):
                    section_header_info = extract_section_header_from_blocks(chunk_blocks)
                
                # PHASE 2: Propagate section header if no new one found
                if section_header_info:
                    # New section header found - update current section
                    current_section_header = section_header_info['section_header']
                    current_section_title = section_header_info['section_title']
                    current_section_level = section_header_info['section_level']
                    logger.debug(f"📑 [SECTION_HEADER] Chunk {i}: Found new section header '{current_section_header}' (level {current_section_level})")
                elif current_section_header:
                    # No new header, but we have a current section - propagate it
                    section_header_info = {
                        "section_header": current_section_header,
                        "section_title": current_section_title,
                        "section_level": current_section_level,
                        "page_number": None,  # Not from this chunk
                        "bbox": None
                    }
                    logger.debug(f"📑 [SECTION_HEADER] Chunk {i}: Propagating section '{current_section_header}'")
                
                # Fallback: Check chunk_meta for section header (legacy support)
                if not section_header_info:
                    section_header = chunk_meta.get('section_header') if chunk_meta else None
                    section_title = chunk_meta.get('section_title') if chunk_meta else None
                    section_level = chunk_meta.get('section_level') if chunk_meta else None
                    normalized_header = chunk_meta.get('normalized_header') if chunk_meta else None
                    has_section_header = chunk_meta.get('has_section_header', False) if chunk_meta else False
                    
                    if has_section_header and section_header:
                        section_header_info = {
                            "section_header": section_header,
                            "section_title": section_title or normalized_header,
                            "section_level": section_level or 2,  # Default to level 2
                            "page_number": chunk_page,
                            "bbox": chunk_bbox
                        }
                        # Update current section for propagation
                        current_section_header = section_header
                        current_section_title = section_title or normalized_header
                        current_section_level = section_level or 2
                
                # Store section header info in metadata JSONB
                chunk_metadata_jsonb = {}
                if section_header_info:
                    # Extract keywords from section header
                    section_keywords = extract_keywords(section_header_info['section_header'])
                    
                    chunk_metadata_jsonb = {
                        'section_header': section_header_info['section_header'],
                        'section_title': section_header_info['section_title'],  # Normalized title (used as section_id)
                        'section_level': section_header_info['section_level'],  # Hierarchy level (1, 2, 3)
                        'normalized_header': section_header_info['section_title'],  # Same as section_title
                        'section_keywords': section_keywords,
                        'has_section_header': (section_header_info.get('page_number') is not None)  # True if header is in this chunk
                    }
                else:
                    # No section header (document start, before first header)
                    chunk_metadata_jsonb = {
                        'has_section_header': False,
                        'section_title': None,
                        'section_level': None
                    }
                
                # Extract image blocks from chunk_blocks for citation purposes
                if chunk_blocks and isinstance(chunk_blocks, list):
                    image_blocks = [
                        {
                            'image_url': block.get('image_url'),
                            'bbox': block.get('bbox'),
                            'page': block.get('bbox', {}).get('page') if block.get('bbox') else None,
                            'type': block.get('type')
                        }
                        for block in chunk_blocks
                        if isinstance(block, dict) and block.get('type') in ['Figure', 'Table'] and block.get('image_url')
                    ]
                    if image_blocks:
                        # Add images array to metadata (merge with existing metadata)
                        if not chunk_metadata_jsonb:
                            chunk_metadata_jsonb = {}
                        chunk_metadata_jsonb['images'] = image_blocks
                        logger.debug(f"📸 Added {len(image_blocks)} image references to chunk {i} metadata")
                
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
                
                # CRITICAL FIX: Store bbox as JSONB dict (not JSON string)
                # JSONB columns in Supabase expect Python dict directly
                # Reducto bbox format: {left, top, width, height, page, original_page}
                bbox_for_storage = None
                if chunk_bbox:
                    if isinstance(chunk_bbox, dict):
                        # Ensure bbox follows Reducto format and is clean dict
                        bbox_for_storage = {
                            'left': chunk_bbox.get('left'),
                            'top': chunk_bbox.get('top'),
                            'width': chunk_bbox.get('width'),
                            'height': chunk_bbox.get('height'),
                            'page': chunk_bbox.get('page'),
                            'original_page': chunk_bbox.get('original_page')
                        }
                        # Remove None values to keep bbox clean
                        bbox_for_storage = {k: v for k, v in bbox_for_storage.items() if v is not None}
                        # If all values were None, set to None instead of empty dict
                        if not bbox_for_storage:
                            bbox_for_storage = None
                    else:
                        logger.warning(f"⚠️ Chunk {i} bbox is not a dict: {type(chunk_bbox)}")
                
                # Log bbox extraction for debugging (only in verbose mode)
                # Removed verbose bbox logging to reduce terminal noise
                
                # Clean and prepare blocks for storage (JSONB array)
                # Each block contains: type, content, bbox, confidence, logprobs_confidence, image_url
                # Phase 6: Verify block storage structure - ensure blocks have required fields
                blocks_for_storage = []
                blocks_validated = 0
                blocks_invalid = 0
                
                if chunk_blocks and isinstance(chunk_blocks, list):
                    for block_idx, block in enumerate(chunk_blocks):
                        if isinstance(block, dict):
                            # Phase 6: Validate block structure - must have content OR be an image block with image_url
                            block_content = block.get('content')
                            block_bbox = block.get('bbox')
                            block_type = block.get('type', '')
                            block_image_url = block.get('image_url')
                            
                            # Check if this is an image block (Figure/Table) with image_url
                            is_image_block = block_type in ['Figure', 'Table'] and block_image_url
                            has_content = block_content and isinstance(block_content, str) and block_content.strip()
                            
                            # Validation: Block must have content OR be an image block with image_url and bbox
                            if not has_content and not is_image_block:
                                blocks_invalid += 1
                                logger.warning(
                                    f"⚠️ [BLOCK_VALIDATION] Block {block_idx} in chunk {i} missing content and not an image block. "
                                    f"Block will be skipped (required for citation matching)."
                                )
                                continue
                            
                            # For image blocks, require bbox for citation
                            if is_image_block and not block_bbox:
                                blocks_invalid += 1
                                logger.warning(
                                    f"⚠️ [BLOCK_VALIDATION] Image block {block_idx} in chunk {i} missing bbox. "
                                    f"Block will be skipped (bbox required for image citation)."
                                )
                                continue
                            
                            # Validation: Block should have bbox (warn if missing, but allow)
                            if not block_bbox or not isinstance(block_bbox, dict):
                                logger.warning(
                                    f"⚠️ [BLOCK_VALIDATION] Block {block_idx} in chunk {i} missing bbox. "
                                    f"Block will be stored but cannot be used for precise citations."
                                )
                            
                            # Clean block bbox (similar to chunk bbox)
                            block_bbox_clean = None
                            if block_bbox and isinstance(block_bbox, dict):
                                block_bbox_raw = block_bbox
                                block_bbox_clean = {
                                    'left': block_bbox_raw.get('left'),
                                    'top': block_bbox_raw.get('top'),
                                    'width': block_bbox_raw.get('width'),
                                    'height': block_bbox_raw.get('height'),
                                    'page': block_bbox_raw.get('page'),
                                    'original_page': block_bbox_raw.get('original_page')
                                }
                                # Remove None values
                                block_bbox_clean = {k: v for k, v in block_bbox_clean.items() if v is not None}
                                
                                # Validation: Verify bbox has required coordinates
                                if block_bbox_clean:
                                    required_bbox_fields = ['left', 'top', 'width', 'height']
                                    missing_fields = [f for f in required_bbox_fields if f not in block_bbox_clean]
                                    if missing_fields:
                                        logger.warning(
                                            f"⚠️ [BLOCK_VALIDATION] Block {block_idx} in chunk {i} bbox missing fields: {missing_fields}. "
                                            f"Bbox may be incomplete."
                                        )
                                    
                                    # Validation: Verify bbox values are in valid range (0-1 for normalized coordinates)
                                    for field in ['left', 'top', 'width', 'height']:
                                        if field in block_bbox_clean:
                                            value = block_bbox_clean[field]
                                            if not isinstance(value, (int, float)) or value < 0 or value > 1:
                                                logger.warning(
                                                    f"⚠️ [BLOCK_VALIDATION] Block {block_idx} in chunk {i} bbox.{field} "
                                                    f"has invalid value: {value} (expected 0-1 for normalized coordinates)"
                                                )
                                
                                if not block_bbox_clean:
                                    block_bbox_clean = None
                            
                            # Build clean block metadata
                            clean_block = {
                                'type': block.get('type'),
                                'content': block_content.strip() if block_content and isinstance(block_content, str) else None,  # Allow None for image blocks
                                'bbox': block_bbox_clean,
                                'confidence': block.get('confidence'),
                                'logprobs_confidence': block.get('logprobs_confidence'),
                                'image_url': block.get('image_url')
                            }
                            # Remove None values (except bbox and content which can be None for image blocks)
                            clean_block = {k: v for k, v in clean_block.items() if v is not None or k in ['bbox', 'content']}
                            
                            # Phase 6: Final validation - ensure content is present OR it's an image block with image_url and bbox
                            has_final_content = clean_block.get('content')
                            is_final_image_block = clean_block.get('type') in ['Figure', 'Table'] and clean_block.get('image_url') and clean_block.get('bbox')
                            
                            if has_final_content or is_final_image_block:
                                blocks_for_storage.append(clean_block)
                                blocks_validated += 1
                                if is_final_image_block:
                                    logger.debug(f"✅ [BLOCK_VALIDATION] Stored image block {block_idx} in chunk {i} (type: {clean_block.get('type')}, has bbox: {bool(clean_block.get('bbox'))})")
                            else:
                                blocks_invalid += 1
                                logger.error(
                                    f"❌ [BLOCK_VALIDATION] Block {block_idx} in chunk {i} failed final validation: "
                                    f"no content and not a valid image block. Block will not be stored."
                                )
                
                # Log block validation statistics
                if blocks_validated > 0 or blocks_invalid > 0:
                    logger.info(
                        f"📊 [BLOCK_VALIDATION] Chunk {i}: {blocks_validated} blocks validated, "
                        f"{blocks_invalid} blocks invalid (skipped)"
                    )
                
                # PHASE 3: Include section header in chunk_text for LLM visibility
                chunk_text_for_storage = chunk  # Original chunk text
                if section_header_info and section_header_info.get('section_header'):
                    # Prepend section header to chunk text
                    section_prefix = f"[Section: {section_header_info['section_header']}]\n\n"
                    chunk_text_for_storage = section_prefix + chunk_text_for_storage
                    logger.debug(f"📑 [SECTION_HEADER] Chunk {i}: Added section prefix to chunk_text")
                
                record = {
                    'id': str(uuid.uuid4()),
                    'document_id': document_id,
                    'property_id': metadata.get('property_id'),
                    'chunk_text': chunk_text_for_storage,  # Includes section header prefix if available
                    'chunk_text_clean': cleaned_chunks[i] if not lazy_embedding else None,  # Clean text (for embedding) - NO section prefix
                    'chunk_context': chunk_context,  # Generated context (for reference)
                    'chunk_quality_score': quality_scores[i] if i < len(quality_scores) else None,  # Quality score (0.0-1.0)
                    'embedding': embedding,  # Embedding of cleaned chunk (or None for lazy)
                    'chunk_index': i,
                    'classification_type': metadata.get('classification_type'),
                    'address_hash': metadata.get('address_hash'),
                    'business_uuid': business_uuid,
                    'business_id': business_uuid,
                    'page_number': chunk_page,  # Prefer original_page per Reducto recommendation
                    'bbox': bbox_for_storage,  # ✅ FIXED: Store as JSONB dict (not JSON string)
                    'blocks': blocks_for_storage if blocks_for_storage else None,  # ✅ CRITICAL: Store validated blocks array for citation mapping
                    'block_count': len(blocks_for_storage),
                    'embedding_status': embedding_status,  # NEW: Track embedding status
                    'embedding_queued_at': embedding_queued_at,  # NEW: When embedding was queued
                    'embedding_completed_at': embedding_completed_at,  # NEW: When embedding completed
                    'embedding_error': embedding_error,  # NEW: Error message if embedding failed
                    'embedding_model': self.embedding_model if not lazy_embedding else None,  # NEW: Model used
                    'metadata': chunk_metadata_jsonb if chunk_metadata_jsonb else None,  # NEW: Section header metadata (JSONB)
                    'created_at': datetime.utcnow().isoformat()
                }
                records.append(record)
            
            # Count bbox and page_number statistics before insertion
            bbox_count = sum(1 for r in records if r.get('bbox') is not None)
            page_count = sum(1 for r in records if r.get('page_number') is not None)
            both_count = sum(1 for r in records if r.get('bbox') is not None and r.get('page_number') is not None)
            
            logger.info(f"📊 Vector storage summary for {document_id}:")
            logger.info(f"   Total vectors: {len(records)}")
            logger.info(f"   Vectors with bbox: {bbox_count} ({bbox_count/len(records)*100:.1f}%)")
            logger.info(f"   Vectors with page_number: {page_count} ({page_count/len(records)*100:.1f}%)")
            logger.info(f"   Vectors with both: {both_count} ({both_count/len(records)*100:.1f}%)")
            
            # Insert into Supabase
            result = self.supabase.table(self.document_vectors_table).insert(records).execute()
            
            if result.data:
                logger.info(f"✅ Stored {len(records)} document vectors (bbox: {bbox_count}, page: {page_count}, both: {both_count})")
                return True
            else:
                logger.error(f"Failed to store document vectors: {result}")
                return False
                
        except Exception as e:
            logger.error(f"Error storing document vectors: {e}")
            return False
    
    def update_chunk_contexts(
        self,
        document_id: str,
        chunk_contexts: Dict[int, str]  # {chunk_index: context_string}
    ) -> bool:
        """
        Update chunk_context for specific chunks after background generation.
        
        This method is called by background tasks to update chunk contexts
        that were generated asynchronously.
        
        Args:
            document_id: Document UUID
            chunk_contexts: Dict mapping chunk_index to context string
            
        Returns:
            Success status
        """
        try:
            if not chunk_contexts:
                logger.warning(f"No chunk contexts provided for document {document_id}")
                return True  # Not an error, just nothing to update
            
            updated_count = 0
            failed_count = 0
            
            # Update each chunk's context
            for chunk_index, context in chunk_contexts.items():
                try:
                    result = self.supabase.table(self.document_vectors_table)\
                        .update({'chunk_context': context})\
                        .eq('document_id', document_id)\
                        .eq('chunk_index', chunk_index)\
                        .execute()
                    
                    if result.data and len(result.data) > 0:
                        updated_count += 1
                    else:
                        logger.warning(
                            f"⚠️ No chunk found with document_id={document_id}, chunk_index={chunk_index} "
                            f"(chunk may not exist yet or index mismatch)"
                        )
                        failed_count += 1
                        
                except Exception as e:
                    logger.error(f"Error updating context for chunk {chunk_index} of document {document_id}: {e}")
                    failed_count += 1
            
            if updated_count > 0:
                logger.info(
                    f"✅ Updated {updated_count}/{len(chunk_contexts)} chunk contexts for document {document_id}"
                )
                if failed_count > 0:
                    logger.warning(f"⚠️ Failed to update {failed_count} chunk contexts")
            
            return updated_count > 0
            
        except Exception as e:
            logger.error(f"Error updating chunk contexts for document {document_id}: {e}")
            import traceback
            logger.debug(traceback.format_exc())
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

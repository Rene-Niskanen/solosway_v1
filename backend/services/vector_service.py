"""
Vector Service for Supabase with pgvector
"""
import os
import logging
from typing import Dict, Any, List, Optional
import openai
from supabase import create_client, Client
import json
import uuid
from datetime import datetime

logger = logging.getLogger(__name__)

class SupabaseVectorService:
    """Service for managing vector embeddings in Supabase with pgvector"""
    
    def __init__(self):
        self.supabase_url = os.environ.get('SUPABASE_URL')
        self.supabase_key = os.environ.get('SUPABASE_SERVICE_KEY')
        
        if not self.supabase_url or not self.supabase_key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required")
        
        # Initialize Supabase client
        self.supabase: Client = create_client(self.supabase_url, self.supabase_key)
        
        # Initialize OpenAI for embeddings
        self.openai_api_key = os.environ.get('OPENAI_API_KEY')
        if not self.openai_api_key:
            raise ValueError("OPENAI_API_KEY environment variable is required")
        
        openai.api_key = self.openai_api_key
        self.embedding_model = "text-embedding-3-small"
        
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
    
    def chunk_text(self, text: str, chunk_size: int = 512, overlap: int = 50) -> List[str]:
        """
        Split text into overlapping chunks
        
        Args:
            text: Text to chunk
            chunk_size: Maximum size of each chunk
            overlap: Number of characters to overlap between chunks
            
        Returns:
            List of text chunks
        """
        if not text:
            return []
        
        chunks = []
        start = 0
        
        while start < len(text):
            end = start + chunk_size
            
            # Try to break at word boundary
            if end < len(text):
                # Look for last space within chunk
                last_space = text.rfind(' ', start, end)
                if last_space > start:
                    end = last_space
            
            chunk = text[start:end].strip()
            if chunk:
                chunks.append(chunk)
            
            start = end - overlap if end < len(text) else end
        
        return chunks
    
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
        chunk_metadata_list: Optional[List[Dict[str, Any]]] = None  # NEW: Per-chunk metadata
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
        Returns:
            Success status
        """
        try:
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
                    sub_chunks = self.chunk_text(chunk, chunk_size=512, overlap=50)
                    
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
            
            # Generate embeddings AFTER chunking is complete
            embeddings = self.create_embeddings(chunks)
            
            if len(embeddings) != len(chunks):
                raise ValueError(f"Embedding count mismatch: {len(embeddings)} vs {len(chunks)}")
            
            # Prepare records for insertion
            records = []
            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                chunk_meta = chunk_metadata_list[i] if chunk_metadata_list and i < len(chunk_metadata_list) else {}
                
                # Extract bbox for the insertion 
                chunk_bbox = chunk_meta.get('bbox')
                # Handle both dict and already-extracted page number
                if chunk_bbox:
                    if isinstance(chunk_bbox, dict):
                        chunk_page = chunk_bbox.get('page')
                    else:
                        chunk_page = chunk_meta.get('page')
                else:
                    chunk_page = chunk_meta.get('page')
                
                chunk_blocks = chunk_meta.get('blocks', [])
                
                record = {
                    'id': str(uuid.uuid4()),
                    'document_id': document_id,
                    'property_id': metadata.get('property_id'),
                    'chunk_text': chunk,
                    'embedding': embedding,
                    'chunk_index': i,
                    'classification_type': metadata.get('classification_type'),
                    'address_hash': metadata.get('address_hash'),
                    'business_uuid': metadata.get('business_uuid'),
                    'page_number': chunk_page,
                    'bbox': json.dumps(chunk_bbox) if chunk_bbox else None,
                    'block_count': len(chunk_blocks),
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
                    'business_uuid': metadata.get('business_uuid'),
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

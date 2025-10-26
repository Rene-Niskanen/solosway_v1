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
        self.embedding_model = "text-embedding-ada-002"
        
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
    
    def store_document_vectors(self, document_id: str, chunks: List[str], metadata: Dict[str, Any]) -> bool:
        """
        Store document vectors in Supabase
        
        Args:
            document_id: Document UUID
            chunks: List of text chunks
            metadata: Metadata to store with vectors
            
        Returns:
            Success status
        """
        try:
            if not chunks:
                logger.warning("No chunks to store for document")
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
                    'document_id': document_id,
                    'property_id': metadata.get('property_id'),
                    'chunk_text': chunk,
                    'embedding': embedding,
                    'chunk_index': i,
                    'classification_type': metadata.get('classification_type'),
                    'address_hash': metadata.get('address_hash'),
                    'business_id': metadata.get('business_id'),
                    'created_at': datetime.utcnow().isoformat()
                }
                records.append(record)
            
            # Insert into Supabase
            result = self.supabase.table(self.document_vectors_table).insert(records).execute()
            
            if result.data:
                # Document vectors stored successfully
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
                    'property_description': property_text,  # Add the required property_description field
                    'chunk_text': chunk,
                    'embedding': embedding,
                    'chunk_index': i,
                    'address_hash': metadata.get('address_hash'),
                    'business_id': metadata.get('business_id'),
                    'property_address': metadata.get('property_address'),
                    'created_at': datetime.utcnow().isoformat()
                }
                records.append(record)
            
            # Insert into Supabase
            result = self.supabase.table(self.property_vectors_table).insert(records).execute()
            
            if result.data:
                # Property vectors stored successfully
                return True
            else:
                logger.error(f"Failed to store property vectors: {result}")
                return False
                
        except Exception as e:
            logger.error(f"Error storing property vectors: {e}")
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
                'business_id': business_id,
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
                'business_id': business_id,
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
            doc_vector_count = self.supabase.table(self.document_vectors_table).select('id', count='exact').eq('business_id', business_id).execute()
            
            # Count property vectors
            prop_vector_count = self.supabase.table(self.property_vectors_table).select('id', count='exact').eq('business_id', business_id).execute()
            
            return {
                'document_vectors': doc_vector_count.count if doc_vector_count.count else 0,
                'property_vectors': prop_vector_count.count if prop_vector_count.count else 0,
                'total_vectors': (doc_vector_count.count or 0) + (prop_vector_count.count or 0)
            }
            
        except Exception as e:
            logger.error(f"Error getting vector statistics: {e}")
            return {}

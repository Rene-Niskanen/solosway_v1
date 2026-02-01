"""
Service for generating document-level summaries and embeddings.
Used for Level 1 (document) retrieval in two-level RAG architecture.

Uses local Ollama (llama3.2:3b) for summary generation to avoid OpenAI costs.
"""

from typing import Dict, List, Optional
import logging
import json
import os
from backend.services.local_document_summary_service import LocalDocumentSummaryService
from backend.services.local_embedding_service import get_default_service
from backend.services.supabase_client_factory import get_supabase_client

logger = logging.getLogger(__name__)

class DocumentSummaryService:
    """Generate document summaries for embedding."""
    
    def __init__(self):
        """Initialize DocumentSummaryService."""
        self.local_summary_service = LocalDocumentSummaryService()
        self.use_openai_fallback = os.environ.get('USE_OPENAI_FALLBACK', 'false').lower() == 'true'
        
    def generate_document_summary(self, document: Dict, chunks: List[Dict]) -> str:
        """
        Generate a concise summary of the document for embedding.
        
        Args:
            document: Document record from Supabase
            chunks: List of chunk records
            
        Returns:
            Summary text (300-800 tokens) suitable for embedding
        """
        # Extract key information from document_summary JSONB
        doc_summary = document.get('document_summary', {}) or {}
        if isinstance(doc_summary, str):
            try:
                doc_summary = json.loads(doc_summary)
            except (json.JSONDecodeError, TypeError):
                doc_summary = {}
        
        # Build summary parts from metadata
        summary_parts = []
        
        # Document type
        doc_type = document.get('classification_type') or doc_summary.get('document_type', 'document')
        
        # Property address (if extracted)
        address = (
            doc_summary.get('extracted_address') or 
            doc_summary.get('normalized_address') or
            doc_summary.get('property_address')
        )
        
        # Key topics (if available)
        topics = doc_summary.get('key_topics', [])
        if isinstance(topics, str):
            # Handle if stored as comma-separated string
            topics = [t.strip() for t in topics.split(',') if t.strip()]
        
        # Generate LLM summary from chunks (CRITICAL: Must use LLM, not heuristics)
        llm_summary = None
        if chunks:
            try:
                # Prepare chunk context for LLM
                chunk_texts = [
                    c.get('chunk_text_clean') or c.get('chunk_text', '') or c.get('content', '')
                    for c in chunks[:10]  # Use first 10 chunks for better context
                    if c.get('chunk_text_clean') or c.get('chunk_text', '') or c.get('content', '')
                ]
                
                if chunk_texts:
                    # Generate canonical summary using local Ollama
                    llm_summary = self._generate_llm_summary(
                        chunks=chunks[:10],
                        doc_type=doc_type,
                        address=address
                    )
            except Exception as e:
                logger.error(f"Failed to generate LLM summary: {e}")
                # Continue without LLM summary if it fails
        
        # If LLM summary was generated, use it (it already includes structured format)
        if llm_summary:
            return llm_summary
        
        # Fallback: Build basic summary from metadata only (if LLM failed)
        if doc_type:
            summary_parts.append(f"Document Type: {doc_type}")
        if address:
            summary_parts.append(f"Property: {address}")
        if topics:
            summary_parts.append(f"Key Topics: {', '.join(topics[:10])}")  # Limit to 10 topics
        
        if summary_parts:
            return '\n'.join(summary_parts)
        else:
            # Last resort: minimal summary
            return f"Document Type: {doc_type or 'document'}"
    
    def _generate_llm_summary(
        self, 
        chunks: List[Dict], 
        doc_type: str, 
        address: Optional[str]
    ) -> Optional[str]:
        """
        Generate canonical document summary using local Ollama LLM.
        
        This is the semantic fingerprint for Level-1 routing.
        Must be deterministic and structured.
        
        Args:
            chunks: List of chunk dictionaries
            doc_type: Document classification type
            address: Optional property address
            
        Returns:
            Structured summary text or None if generation failed
        """
        try:
            # Use local Ollama service
            summary = self.local_summary_service.generate_document_summary(
                chunks=chunks,
                document_type=doc_type,
                property_address=address,
                max_chunks=10,
                max_chunk_length=2000
            )
            
            if summary:
                logger.info(f"✅ Generated LLM summary using Ollama ({len(summary)} chars)")
                return summary
            else:
                logger.warning("⚠️ Ollama summary generation returned None")
                
                # Optional OpenAI fallback
                if self.use_openai_fallback:
                    logger.info("🔄 Attempting OpenAI fallback for summary generation...")
                    return self._generate_llm_summary_openai(chunks, doc_type, address)
                else:
                    return None
                    
        except Exception as e:
            logger.error(f"❌ Local LLM summary generation failed: {e}")
            
            # Optional OpenAI fallback
            if self.use_openai_fallback:
                logger.info("🔄 Attempting OpenAI fallback for summary generation...")
                try:
                    return self._generate_llm_summary_openai(chunks, doc_type, address)
                except Exception as fallback_error:
                    logger.error(f"❌ OpenAI fallback also failed: {fallback_error}")
                    return None
            else:
                return None
    
    def _generate_llm_summary_openai(
        self, 
        chunks: List[Dict], 
        doc_type: str, 
        address: Optional[str]
    ) -> Optional[str]:
        """
        Fallback: Generate summary using OpenAI (if enabled).
        
        Args:
            chunks: List of chunk dictionaries
            doc_type: Document classification type
            address: Optional property address
            
        Returns:
            Structured summary text or None if generation failed
        """
        try:
            from langchain_openai import ChatOpenAI
            from langchain.prompts import ChatPromptTemplate
            from langchain_core.messages import HumanMessage
            
            # Prepare chunk text
            chunk_texts = [
                c.get('chunk_text_clean') or c.get('chunk_text', '') or c.get('content', '')
                for c in chunks[:10]
                if c.get('chunk_text_clean') or c.get('chunk_text', '') or c.get('content', '')
            ]
            combined_text = '\n\n'.join(chunk_texts[:4000])  # Limit to 4000 chars
            
            llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)  # Temperature=0 for determinism
            
            system_prompt = """You are summarizing a document for retrieval, not for humans.
Generate a structured summary that will be used for semantic search to find relevant documents.

Include:
- Document type
- Primary subject(s)
- Property name / address (if any)
- Time period
- Key numeric facts
- Legal / financial nature
- Key topics
- What questions this document can answer

Keep it concise (300-800 tokens), structured, and deterministic."""
            
            human_prompt = f"""Document Type: {doc_type}
Property Address: {address or "Not specified"}

Document Content:
{combined_text}

Generate the canonical summary for retrieval:"""
            
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": human_prompt}
            ]
            
            response = llm.invoke(messages)
            summary = response.content.strip()
            
            logger.info(f"✅ Generated LLM summary using OpenAI ({len(summary)} chars)")
            return summary
            
        except Exception as e:
            logger.error(f"OpenAI summary generation failed: {e}")
            return None
    
    def generate_document_embedding_from_chunks(self, document_id: str) -> Optional[List[float]]:
        """
        Generate document embedding by mean pooling all chunk embeddings.
        
        CRITICAL: Document embeddings must be derived from chunk embeddings via mean pooling,
        NOT from summary text. This ensures document embeddings are in the same vector space
        as chunks and are query-independent (computed once at ingestion time).
        
        Args:
            document_id: Document UUID
            
        Returns:
            Embedding vector (1024 dimensions) or None
        """
        try:
            supabase = get_supabase_client()
            
            # Query all chunk embeddings for this document
            logger.debug(f"🔍 Querying chunk embeddings for document {document_id[:8]}...")
            response = supabase.table('document_vectors').select(
                'id, embedding, chunk_text_clean, chunk_quality_score, metadata, page_number'
            ).eq('document_id', document_id).not_.is_('embedding', 'null').execute()
            
            chunks = response.data if response.data else []
            
            if not chunks:
                logger.warning(f"⚠️ No chunks with embeddings found for document {document_id[:8]}")
                return None
            
            logger.debug(f"   Found {len(chunks)} chunks with embeddings")
            
            # Filter out boilerplate chunks
            filtered_chunks = self._filter_boilerplate_chunks(chunks)
            
            if not filtered_chunks:
                logger.warning(f"⚠️ All chunks filtered out as boilerplate for document {document_id[:8]}")
                # Fallback: use all chunks if all were filtered
                filtered_chunks = chunks
                logger.info(f"   Using all {len(chunks)} chunks (fallback after filtering)")
            else:
                logger.debug(f"   After filtering: {len(filtered_chunks)} chunks (removed {len(chunks) - len(filtered_chunks)} boilerplate)")
            
            # Extract embeddings
            embeddings = []
            for chunk in filtered_chunks:
                embedding = chunk.get('embedding')
                if embedding and isinstance(embedding, list):
                    embeddings.append(embedding)
                elif embedding:
                    # Handle case where embedding might be a string representation
                    try:
                        import json
                        if isinstance(embedding, str):
                            embedding = json.loads(embedding)
                        embeddings.append(embedding)
                    except Exception as e:
                        logger.warning(f"   Failed to parse embedding for chunk {chunk.get('id', 'unknown')[:8]}: {e}")
                        continue
            
            if not embeddings:
                logger.error(f"❌ No valid embeddings extracted from chunks for document {document_id[:8]}")
                return None
            
            # Verify all embeddings have same dimension
            first_dim = len(embeddings[0])
            for i, emb in enumerate(embeddings):
                if len(emb) != first_dim:
                    logger.error(
                        f"❌ Embedding dimension mismatch: chunk {i} has {len(emb)} dimensions, "
                        f"expected {first_dim}"
                    )
                    return None
            
            # Mean pooling: average all embeddings element-wise
            import numpy as np
            embeddings_array = np.array(embeddings)
            mean_embedding = np.mean(embeddings_array, axis=0).tolist()
            
            if len(mean_embedding) != 1024:
                logger.error(f"❌ Mean pooled embedding dimension mismatch: expected 1024, got {len(mean_embedding)}")
                return None
            
            logger.info(
                f"✅ Generated document embedding via mean pooling: {len(filtered_chunks)} chunks "
                f"({len(embeddings)} embeddings), dimension: {len(mean_embedding)}"
            )
            
            return mean_embedding
            
        except Exception as e:
            logger.error(f"❌ Failed to generate document embedding from chunks: {e}")
            import traceback
            logger.debug(traceback.format_exc())
            return None
    
    def _filter_boilerplate_chunks(self, chunks: List[Dict]) -> List[Dict]:
        """
        Filter out boilerplate chunks (headers, footers, signatures, low-quality chunks).
        
        Args:
            chunks: List of chunk dictionaries with embedding, metadata, quality_score, etc.
            
        Returns:
            Filtered list of chunks (boilerplate removed)
        """
        filtered = []
        
        for chunk in chunks:
            # Check quality score (exclude low-quality chunks)
            quality_score = chunk.get('chunk_quality_score')
            if quality_score is not None and quality_score < 0.5:
                logger.debug(f"   Filtered chunk {chunk.get('id', 'unknown')[:8]}: low quality score ({quality_score:.2f})")
                continue
            
            # Check chunk length (exclude very short chunks)
            chunk_text = chunk.get('chunk_text_clean') or chunk.get('chunk_text', '')
            if len(chunk_text) < 50:
                logger.debug(f"   Filtered chunk {chunk.get('id', 'unknown')[:8]}: too short ({len(chunk_text)} chars)")
                continue
            
            # Check metadata for boilerplate markers
            metadata = chunk.get('metadata', {})
            if isinstance(metadata, str):
                try:
                    metadata = json.loads(metadata)
                except:
                    metadata = {}
            
            # Check if marked as boilerplate
            if isinstance(metadata, dict) and metadata.get('is_boilerplate', False):
                logger.debug(f"   Filtered chunk {chunk.get('id', 'unknown')[:8]}: marked as boilerplate")
                continue
            
            # Check section title for header/footer indicators
            section_title = metadata.get('section_title', '') if isinstance(metadata, dict) else ''
            if section_title:
                section_lower = section_title.lower()
                if any(marker in section_lower for marker in ['header', 'footer', 'signature', 'page number']):
                    logger.debug(f"   Filtered chunk {chunk.get('id', 'unknown')[:8]}: boilerplate section ({section_title})")
                    continue
            
            # Check page number (exclude first/last pages if they're likely headers/footers)
            # NOTE: This is conservative - we only filter if chunk is very short AND on first/last page
            page_number = chunk.get('page_number')
            if page_number is not None and len(chunk_text) < 100:
                # Very short chunks on first/last pages are likely headers/footers
                # But we need to know total pages to do this properly, so skip for now
                pass
            
            # Chunk passed all filters
            filtered.append(chunk)
        
        return filtered
    
    def generate_document_embedding(self, summary_text: str) -> Optional[List[float]]:
        """
        DEPRECATED: Generate embedding for document summary using Voyage AI.
        
        This method is deprecated. Use generate_document_embedding_from_chunks() instead.
        Document embeddings should be derived from chunk embeddings via mean pooling,
        not from summary text.
        
        This method is kept for backward compatibility but should not be used for new code.
        
        Args:
            summary_text: Document summary text (deprecated - not used for embeddings)
            
        Returns:
            Embedding vector (1024 dimensions) or None
        """
        logger.warning(
            "⚠️ generate_document_embedding(summary_text) is deprecated. "
            "Use generate_document_embedding_from_chunks(document_id) instead."
        )
        
        try:
            import os
            use_voyage = os.environ.get('USE_VOYAGE_EMBEDDINGS', 'true').lower() == 'true'
            
            if use_voyage:
                # Use Voyage AI for document embeddings (1024 dimensions)
                from voyageai import Client
                voyage_api_key = os.environ.get('VOYAGE_API_KEY')
                if not voyage_api_key:
                    logger.error("❌ VOYAGE_API_KEY not set, cannot generate document embedding")
                    return None
                
                voyage_client = Client(api_key=voyage_api_key)
                voyage_model = os.environ.get('VOYAGE_EMBEDDING_MODEL', 'voyage-law-2')
                
                response = voyage_client.embed(
                    texts=[summary_text],
                    model=voyage_model,
                    input_type='document'  # Use 'document' for document embeddings
                )
                
                embedding = response.embeddings[0]
                if len(embedding) != 1024:
                    logger.error(f"❌ Voyage embedding dimension mismatch: expected 1024, got {len(embedding)}")
                    return None
                
                logger.info(f"✅ Generated document embedding using Voyage AI ({len(embedding)} dimensions)")
                return embedding
            else:
                # Fallback to OpenAI if Voyage is disabled
                logger.warning("⚠️ Voyage embeddings disabled, using OpenAI fallback")
                return self._generate_embedding_openai(summary_text)
                
        except Exception as e:
            logger.error(f"Failed to generate Voyage embedding: {e}")
            # Try OpenAI fallback
            try:
                logger.warning("⚠️ Voyage embedding failed, trying OpenAI fallback")
                return self._generate_embedding_openai(summary_text)
            except Exception as fallback_error:
                logger.error(f"OpenAI embedding fallback also failed: {fallback_error}")
                return None
    
    def _generate_embedding_openai(self, text: str) -> Optional[List[float]]:
        """
        Generate embedding using OpenAI (fallback when Voyage is disabled).
        
        NOTE: OpenAI embeddings are 1536 dimensions, but database expects 1024.
        This is a fallback only - Voyage should be used for production.
        
        Args:
            text: Text to embed
            
        Returns:
            Embedding vector (1536 dimensions) or None
        """
        try:
            from openai import OpenAI
            
            api_key = os.environ.get('OPENAI_API_KEY')
            if not api_key:
                logger.error("❌ OPENAI_API_KEY not set, cannot generate document embedding")
                return None
            
            client = OpenAI(api_key=api_key)
            response = client.embeddings.create(
                model="text-embedding-3-small",  # 1536 dimensions
                input=text
            )
            
            embedding = response.data[0].embedding
            logger.warning(
                f"⚠️ Using OpenAI embedding ({len(embedding)} dimensions) - "
                f"dimension mismatch with database (expects 1024). "
                f"Voyage should be used for production."
            )
            
            logger.info(f"✅ Generated document embedding using OpenAI ({len(embedding)} dimensions)")
            return embedding
            
        except Exception as e:
            logger.error(f"❌ OpenAI embedding generation failed: {e}")
            return None
    
    def _extract_key_topics(self, chunks: List[Dict], document: Dict) -> List[str]:
        """
        Extract key topics from chunks and document metadata.
        
        Simple keyword extraction (can be enhanced with NER later).
        
        Args:
            chunks: List of chunk records
            document: Document record
            
        Returns:
            List of topic strings
        """
        topics = set()
        
        # Extract from document_summary if available
        doc_summary = document.get('document_summary', {}) or {}
        if isinstance(doc_summary, str):
            try:
                doc_summary = json.loads(doc_summary)
            except (json.JSONDecodeError, TypeError):
                doc_summary = {}
        
        # Add document type as topic
        doc_type = document.get('classification_type') or doc_summary.get('document_type')
        if doc_type:
            topics.add(doc_type.replace('_', ' ').title())
        
        # Extract from document_summary key_topics if available
        existing_topics = doc_summary.get('key_topics', [])
        if isinstance(existing_topics, list):
            topics.update([str(t) for t in existing_topics if t])
        elif isinstance(existing_topics, str):
            topics.update([t.strip() for t in existing_topics.split(',') if t.strip()])
        
        # Extract property address if available
        address = (
            doc_summary.get('extracted_address') or 
            doc_summary.get('normalized_address') or
            doc_summary.get('property_address')
        )
        if address:
            # Extract property name (first part of address)
            property_name = address.split(',')[0].strip()
            if property_name and len(property_name) > 2:
                topics.add(property_name)
        
        # Extract from first few chunks (simple keyword extraction)
        # Look for common real estate terms
        real_estate_keywords = [
            'valuation', 'appraisal', 'lease', 'purchase', 'sale', 'offer',
            'property', 'building', 'land', 'plot', 'parcel', 'estate',
            'mortgage', 'loan', 'rent', 'tenancy', 'freehold', 'leasehold'
        ]
        
        for chunk in chunks[:5]:  # Check first 5 chunks
            text = (
                chunk.get('chunk_text_clean', '') or 
                chunk.get('chunk_text', '') or 
                chunk.get('content', '')
            ).lower()
            
            for keyword in real_estate_keywords:
                if keyword in text:
                    topics.add(keyword.title())
        
        # Limit to top 15 topics
        return list(topics)[:15]
    
    def update_document_embedding(
        self, 
        document_id: str, 
        summary_text: str,
        key_topics: Optional[List[str]] = None
    ) -> bool:
        """
        Update document with summary and embedding.
        
        CRITICAL: Document embedding is now generated from chunk embeddings via mean pooling,
        NOT from summary text. Summary text is kept for UI/keyword search only.
        
        Args:
            document_id: Document UUID
            summary_text: Generated summary (for UI/keyword search, NOT for embedding)
            key_topics: List of extracted topics (optional, will be extracted if not provided)
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Generate embedding from chunks (mean pooling)
            embedding = self.generate_document_embedding_from_chunks(document_id)
            
            if not embedding:
                logger.warning(f"Could not generate embedding from chunks for document {document_id}")
                return False
            
            # Get Supabase client
            supabase = get_supabase_client()
            
            # Prepare update data
            update_data = {
                'summary_text': summary_text,  # Keep summary for UI/keyword search
                'document_embedding': embedding,  # Mean-pooled from chunks
            }
            
            # Add key_topics if provided
            if key_topics:
                update_data['key_topics'] = key_topics
            
            # Update documents table directly
            result = supabase.table('documents').update(update_data).eq('id', document_id).execute()
            
            if result.data:
                logger.info(f"✅ Updated document embedding for {document_id}")
                logger.debug(f"   Summary length: {len(summary_text)} chars")
                logger.debug(f"   Embedding dimensions: {len(embedding)}")
                logger.debug(f"   Key topics: {len(key_topics) if key_topics else 0}")
                return True
            else:
                logger.warning(f"⚠️ No document found with id {document_id}")
                return False
            
        except Exception as e:
            logger.error(f"Failed to update document embedding: {e}")
            import traceback
            logger.debug(traceback.format_exc())
            return False
    
    def generate_and_update_document_embedding(
        self,
        document: Dict,
        chunks: List[Dict]
    ) -> bool:
        """
        Generate summary, embedding, and update database in one call.
        
        Convenience method that combines all steps.
        
        Args:
            document: Document record from Supabase
            chunks: List of chunk records
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Generate summary
            summary_text = self.generate_document_summary(document, chunks)
            
            if not summary_text:
                logger.warning("Could not generate document summary")
                return False
            
            # Extract key topics
            key_topics = self._extract_key_topics(chunks, document)
            
            # Update database
            document_id = str(document.get('id'))
            return self.update_document_embedding(
                document_id=document_id,
                summary_text=summary_text,
                key_topics=key_topics
            )
            
        except Exception as e:
            logger.error(f"Failed to generate and update document embedding: {e}")
            import traceback
            logger.debug(traceback.format_exc())
            return False


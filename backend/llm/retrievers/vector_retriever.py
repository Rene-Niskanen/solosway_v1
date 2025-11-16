"""
Vector similarity search retriever using Supabase pgvector.
"""

from typing import Optional, List
from backend.llm.types import RetrievedDocument
from backend.llm.config import config 
from langchain_openai import OpenAIEmbeddings
import logging 

from backend.services.supabase_client_factory import get_supabase_client

logger = logging.getLogger(__name__)

class VectorDocumentRetriever:
    """Query supabase pgvector using semantic similarity search."""
     
    def __init__(self):
        self.embeddings = OpenAIEmbeddings(
            api_key=config.openai_api_key,
            model=config.openai_embedding_model,
        )
        self.supabase = get_supabase_client()

    def query_documents(
        self,
        user_query: str,
        top_k: int = None,
        property_id: Optional[str] = None,
        classification_type: Optional[str] = None,
        address_hash: Optional[str] = None,
        business_id: Optional[str] = None
    ) -> List[RetrievedDocument]:
        """
        Search for documents using semantic similarity.

        Args:
            user_query: Natural language query to embed
            top_k: Number of results (defauls to config.vector_top_k)
            property_id: Optional filter by property UUID
            classification_type: Optional filter (inspection, appraisal, etc)
            address_hash: Optional filter by address hash 
            business_id: Optional filter by business ID

        Returns:
            List of RetrievedDocument dicts sorted by similarity
        """
        if top_k is None:
            top_k = config.vector_top_k

        try:
            # step one: embed the query 
            query_embedding = self.embeddings.embed_query(user_query)

            def _fetch(match_threshold: float):
                payload = {
                    'query_embedding': query_embedding,
                    'match_count': top_k,
                    'match_threshold': match_threshold,
                    'filter_property_id': property_id,
                    'filter_classification_type': classification_type,
                    'filter_address_hash': address_hash,
                    'filter_business_id': str(business_id) if business_id else None
                }
                response = self.supabase.rpc('match_documents', payload).execute()
                return response.data or []

            # step two: Call supabase RPC with filters + adaptive threshold
            primary_threshold = config.similarity_threshold
            rows = _fetch(primary_threshold)

            if not rows and primary_threshold > config.min_similarity_threshold:
                logger.info(
                    "Vector search returned no rows at threshold %.2f, retrying with %.2f",
                    primary_threshold,
                    config.min_similarity_threshold,
                )
                rows = _fetch(config.min_similarity_threshold)

            # step 3: convert to typed results
            results: List[RetrievedDocument] = []
            for row in rows:
                results.append(
                    RetrievedDocument(
                        vector_id=row["id"],
                        doc_id=row["document_id"],
                        property_id=row.get("property_id"),
                        content=row["chunk_text"],
                        classification_type=row.get("classification_type", ""),
                        chunk_index=row.get("chunk_index", 0),
                        page_number=row.get("page_number", 0),
                        bbox=row.get("bbox"),
                        similarity_score=float(row.get("similarity", 0.0)),
                        source="vector",
                        address_hash=row.get("address_hash"),
                        business_id=row.get("business_uuid"),
                        # NEW: Add filename and address metadata
                        original_filename=row.get("original_filename"),
                        property_address=row.get("property_address") or row.get("formatted_address"),
                    )
                )

            logger.info(f"Vector search returned {len(results)} documents for query: {user_query[:50]}")
            return results

        except Exception as e:
            logger.error(f"vector retrieval failed: {e}")
            return []



    
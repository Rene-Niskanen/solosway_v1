"""
Cohere ranker for document relevance scoring.

Replaces expensive LLM-based reranking with Cohere's specialised reranking API.
Much faster and cheaper than GPT, Gemini, Anthropic reranking.
"""
from typing import List, Dict, Any, Optional 
import os
import logging
import requests

logger = logging.getLogger(__name__)

class CohereReranker:
    """Cohere reranker API client for document relevance and scoring."""
    def __init__(self):
        # Get API key from environment
        self.api_key = os.environ.get('COHERE_API_KEY')
        self.api_url = 'https://api.cohere.ai/rerank'
        self.model = os.environ.get('COHERE_RERANKER_MODEL', 'rerank-english-v3.0')
        self.top_n = int(os.environ.get('COHERE_RERANKER_TOP_N', '10'))
        
        # Validate API key
        self.enabled = bool(self.api_key)

        if self.enabled:
            # Basic validation: Cohere API keys typically start with specific prefixes
            # Log first few chars for debugging (but don't expose full key)
            key_preview = self.api_key[:8] + "..." if len(self.api_key) > 8 else "***"
            logger.info(f"Cohere Reranker initialized: model={self.model}, top_n={self.top_n}, api_key={key_preview}")
        else:
            logger.warning("COHERE_API_KEY not set - Cohere Reranker disabled")
            logger.info("To enable Cohere reranking, set COHERE_API_KEY in your .env file")

    def rerank(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        top_n: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Rerank documents by relevance to query using Cohere's API.

        Args:
            query: Users search query
            documents: List of document dicts with 'content' field
            top_n: Number of results to return (default: self.top_n) 
        
        Returns:
            Reranked list of documents (same format, reordered by relevance)
        """

        if not self.enabled:
            logger.warning("Cohere Reranker disabled - returning original order")
            return documents
        
        if not documents:
            return []
        
        max_docs = 100
        if len(documents) > max_docs:
            logger.warning(
                f"Too many documents ({len(documents)}), limiting to {max_docs}"
            )
            documents = documents[:max_docs]
        
        # Exctract text content for reranking 
        doc_texts = []
        for doc in documents:
            content = doc.get('content', '')
            if not content:
                content = f"{doc.get('classification_type', '')} {doc.get('property_address', '')}"
            doc_texts.append(content)

        # Use the provided top_n or default
        top_n = top_n or self.top_n
        top_n = min(top_n, len(documents))

        try:
            # Validate API key is still available
            if not self.api_key:
                logger.error("Cohere API key not available during rerank call")
                return documents
            
            # call the cohere api
            headers = {
                'Authorization': f'Bearer {self.api_key}',
                'Content-Type': 'application/json'
            }

            payload = {
                'model': self.model,
                'query': query,
                'documents': doc_texts,
                'top_n': top_n,
                'return_documents': False # We have the documents already
            }

            response = requests.post(
                self.api_url,
                headers=headers,
                json=payload,
                timeout=30
            )
            response.raise_for_status()

            result = response.json()

            # Map the cohere results back to original documents
            reranked_docs = []
            for item in result.get('results', []):
                index = item.get('index', -1)
                relevance_score = item.get('relevance_score', 0.0)

                if index >= 0 and index < len(documents):
                    doc = documents[index].copy()
                    # Add the cohere relevance score to the document (0-1, higher is better)
                    doc['similarity_score'] = relevance_score
                    # update the similarity_score to include Cohere's score
                    doc['similarity_score'] = max(
                        doc.get('similarity_score', 0.0),
                        relevance_score
                    )
                    reranked_docs.append(doc)

            logger.info(
                f"Cohere Reranker: Re-ranked {len(reranked_docs)} documents "
                f"(Top {top_n} from {len(documents)} candidates)"
            )

            return reranked_docs

        except requests.exceptions.HTTPError as e:
            # Handle specific HTTP errors (401 = unauthorized, 403 = forbidden, etc.)
            if e.response and e.response.status_code == 401:
                logger.error("Cohere API authentication failed - check COHERE_API_KEY is valid")
            elif e.response and e.response.status_code == 403:
                logger.error("Cohere API access forbidden - check API key permissions")
            else:
                logger.error(f"Cohere rerank API HTTP error: {e}")
            logger.warning("Falling back to original document order")
            return documents
        except requests.exceptions.RequestException as e:
            logger.error(f"Cohere rerank API request error: {e}")
            logger.warning("Falling back to original document order")
            return documents
        
        except Exception as e:
            logger.error(f"Unexpected error in Cohere reranker: {e}")
            logger.warning("falling back to original document order")
            return documents
        
    
    def is_enabled(self) -> bool:
        """Check if reranker is available."""
        return self.enabled
        





"""
Unified AstraDB Data API client for all vector store operations
"""
import requests
import os
import logging
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

class AstraAPIClient:
    """Unified client for AstraDB Data API operations"""

    def __init__(self, api_endpoint: str, token: str):
        self.api_endpoint = api_endpoint
        self.headers = {
            "Token": token,
            "Content-Type": "application/json"
        }

    def find_documents(self, collection: str, filter_dict: Dict, limit: int = 1000) -> List[Dict]:
        """Find documents matching filter criteria using AstraDB Data API v1"""
        # Correct format: POST to collection endpoint with find command
        url = f"{self.api_endpoint}/api/json/v1/default_keyspace/{collection}"
        payload = {
            "find": {
                "filter": filter_dict,
                "options": {
                    "limit": limit
                }
            }
        }

        logger.info(f"Finding documents in {collection}")
        logger.info(f"   URL: {url}")
        logger.info(f"   Filter: {filter_dict}")
        
        try: 
            response = requests.post(url, json=payload, headers=self.headers)
            logger.info(f"   Response status: {response.status_code}")
            response.raise_for_status()
            
            # Parse response - Data API v1 format
            response_data = response.json()
            documents = response_data.get("data", {}).get("documents", [])
            
            # Fallback for different response formats
            if not documents and "documents" in response_data:
                documents = response_data["documents"]
                
            logger.info(f"   Found {len(documents)} documents")
            return documents
        except requests.exceptions.RequestException as e:
            logger.error(f"Error finding documents in {collection}: {e}")
            if 'response' in locals():
                logger.error(f"   Response: {response.text}")
            return []
        
    def delete_document(self, collection: str, doc_id: str) -> bool:
        """Delete a single document by ID using AstraDB Data API v1"""
        # Correct format: POST to collection endpoint with deleteOne command
        url = f"{self.api_endpoint}/api/json/v1/default_keyspace/{collection}"
        payload = {
            "deleteOne": {
                "filter": {
                    "_id": doc_id
                }
            }
        }
        
        try:
            response = requests.post(url, json=payload, headers=self.headers)
            if response.status_code == 200:
                result = response.json()
                deleted_count = result.get("status", {}).get("deletedCount", 0)
                if deleted_count > 0:
                    logger.debug(f"Deleted document {doc_id}")
                    return True
                else:
                    logger.warning(f"Document {doc_id} not found or already deleted")
                    return False
            else:
                logger.warning(f"Failed to delete {doc_id}: status {response.status_code}")
                return False
        except requests.exceptions.RequestException as e:
            logger.error(f"Error deleting document {doc_id} from {collection}: {e}")
            return False

    def delete_documents_by_filter(self, collection: str, filter_dict: Dict) -> tuple:
        """
        Delete all documents matching filter criteria
        Returns: (deleted_count, total_found)
        """
        logger.info(f"delete_documents_by_filter called for {collection}")
        documents = self.find_documents(collection, filter_dict)
        total_found = len(documents)
        deleted_count = 0
        
        logger.info(f"Deleting {total_found} documents from {collection}")
        
        for i, doc in enumerate(documents, 1):
            doc_id = doc.get("_id")
            if doc_id and self.delete_document(collection, doc_id):
                deleted_count += 1
                if i % 10 == 0:  # Log progress every 10 deletions
                    logger.info(f"   Progress: {i}/{total_found} documents deleted")
        
        logger.info(f"Deletion complete: {deleted_count}/{total_found} documents deleted from {collection}")
        return deleted_count, total_found
    
    def collection_exists(self, collection: str) -> bool:
        """Check if collection exists using AstraDB Data API v1"""
        url = f"{self.api_endpoint}/api/json/v1/default_keyspace/{collection}"
        payload = {
            "find": {
                "filter": {},
                "options": {"limit": 1}
            }
        }
        
        try:
            response = requests.post(url, json=payload, headers=self.headers)
            return response.status_code == 200
        except:
            return False
    
def get_document_vector_client() -> AstraAPIClient:
    """Get client for document vector store"""
    return AstraAPIClient(
        api_endpoint=os.environ["ASTRA_DB_VECTOR_API_ENDPOINT"],
        token=os.environ["ASTRA_DB_VECTOR_APPLICATION_TOKEN"]
    )

def get_property_vector_client() -> AstraAPIClient:
    """Get client for property vector store"""
    return AstraAPIClient(
        api_endpoint=os.environ["ASTRA_DB_COMP_API_ENDPOINT"],
        token=os.environ["ASTRA_DB_COMP_APPLICATION_TOKEN"]
    )



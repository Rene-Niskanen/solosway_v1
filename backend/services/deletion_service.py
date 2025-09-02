import os
import requests
import uuid
from cassandra.cluster import Cluster
from cassandra.auth import PlainTextAuthProvider
from llama_index.vector_stores.astra_db import AstraDBVectorStore

class DeletionService:
    def __init__(self):
        self.tabular_session = None
        self.vector_store = None
    
    def delete_document_from_astra_stores(self, document_id, business_id):
        """Delete document data from both AstraDB stores"""
        print(f"Starting AstraDB deletion for document {document_id}, business {business_id}")
        
        try:
            # Delete from tabular store
            tabular_success = self.delete_tabular_data(document_id, business_id)
            print(f"Tabular deletion result: {tabular_success}")
            
            # Delete from vector store  
            vector_success = self.delete_vector_data(document_id, business_id)
            print(f"Vector deletion result: {vector_success}")
            
            overall_success = tabular_success and vector_success
            print(f"Overall AstraDB deletion success: {overall_success}")
            
            return overall_success
            
        except Exception as e:
            print(f"Error in AstraDB deletion: {e}")
            return False
    
    def delete_tabular_data(self, document_id, business_id):
        """Delete comparable properties from AstraDB tabular collection"""
        try:
            session = self._get_astra_db_session()
            keyspace = os.environ['ASTRA_DB_TABULAR_KEYSPACE']
            table_name = os.environ['ASTRA_DB_TABULAR_COLLECTION_NAME']
            
            session.set_keyspace(keyspace)
            
            # Count records before deletion
            count_query = f"SELECT COUNT(*) FROM {table_name} WHERE source_document_id = ? AND business_id = ?"
            count_result = session.execute(count_query, (uuid.UUID(document_id), business_id))
            count_before = count_result.one()[0]
            print(f"Found {count_before} records to delete from tabular store")
            
            if count_before == 0:
                print("No tabular records found - deletion successful (nothing to delete)")
                return True
            
            # Delete records
            delete_query = f"DELETE FROM {table_name} WHERE source_document_id = ? AND business_id = ?"
            prepared_delete = session.prepare(delete_query)
            session.execute(prepared_delete, (uuid.UUID(document_id), business_id))
            
            # Verify deletion
            count_after = session.execute(count_query, (uuid.UUID(document_id), business_id)).one()[0]
            print(f"Records remaining after deletion: {count_after}")
            
            return count_after == 0
            
        except Exception as e:
            print(f"Error deleting tabular data: {e}")
            return False
    
    def delete_vector_data(self, document_id, business_id):
        """Delete document chunks from AstraDB vector store using Data API"""
        try:
            api_endpoint = os.environ["ASTRA_DB_VECTOR_API_ENDPOINT"]
            token = os.environ["ASTRA_DB_VECTOR_APPLICATION_TOKEN"]
            collection_name = "doc_vectors"  # Match the collection you created
            
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
            
            # Find documents with matching metadata
            find_url = f"{api_endpoint}/api/json/v1/collections/{collection_name}/find"
            find_payload = {
                "filter": {
                    "metadata.document_id": str(document_id),
                    "metadata.business_id": str(business_id)
                },
                "options": {
                    "limit": 1000  # Adjust based on expected chunk count
                }
            }
            
            print(f"Searching for vector documents with filter: {find_payload['filter']}")
            response = requests.post(find_url, json=find_payload, headers=headers)
            
            if response.status_code != 200:
                print(f"Error finding vector documents: {response.status_code} - {response.text}")
                return False
            
            documents = response.json().get("data", {}).get("documents", [])
            print(f"Found {len(documents)} vector documents to delete")
            
            if not documents:
                print("No vector documents found - deletion successful (nothing to delete)")
                return True
            
            # Delete each document by ID
            delete_count = 0
            delete_url_base = f"{api_endpoint}/api/json/v1/collections/{collection_name}"
            
            for doc in documents:
                doc_id = doc.get("_id")
                if doc_id:
                    delete_url = f"{delete_url_base}/{doc_id}"
                    delete_response = requests.delete(delete_url, headers=headers)
                    if delete_response.status_code == 200:
                        delete_count += 1
                        print(f"Deleted vector document {doc_id}")
                    else:
                        print(f"Failed to delete vector document {doc_id}: {delete_response.status_code}")
            
            print(f"Successfully deleted {delete_count}/{len(documents)} vector documents")
            return delete_count == len(documents)
            
        except Exception as e:
            print(f"Error deleting vector data: {e}")
            return False
    
    def _get_astra_db_session(self):
        """Get AstraDB session (reuse logic from tasks.py)"""
        if not self.tabular_session:
            bundle_path = os.environ['ASTRA_DB_TABULAR_SECURE_CONNECT_BUNDLE_PATH']
            token = os.environ['ASTRA_DB_TABULAR_APPLICATION_TOKEN']
            
            if not os.path.exists(bundle_path):
                raise ValueError(f"AstraDB secure connect bundle not found at: {bundle_path}")
            
            auth_provider = PlainTextAuthProvider('token', token)
            cluster = Cluster(cloud={'secure_connect_bundle': bundle_path}, auth_provider=auth_provider)
            self.tabular_session = cluster.connect()
        
        return self.tabular_session

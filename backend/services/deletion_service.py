import os
import requests
import uuid
from cassandra.cluster import Cluster
from cassandra.auth import PlainTextAuthProvider

# Fix for astrapy import issue - patch the missing classes
import astrapy.exceptions as astrapy_exceptions
import astrapy.results as astrapy_results

# Patch missing exception
if not hasattr(astrapy_exceptions, 'InsertManyException'):
    astrapy_exceptions.InsertManyException = astrapy_exceptions.CollectionInsertManyException

# Patch missing result class
if not hasattr(astrapy_results, 'UpdateResult'):
    astrapy_results.UpdateResult = astrapy_results.CollectionUpdateResult

from llama_index.vector_stores.astra_db import AstraDBVectorStore

class DeletionService:
    def __init__(self):
        self.tabular_session = None
        self.vector_store = None
    
    def delete_document_from_all_stores(self, document_id, business_id):
        """
        Delete document data from ALL databases in the 5-database architecture:
        1. AstraDB Tabular (comparable properties)
        2. AstraDB Document Vector Store (whole document chunks)
        3. AstraDB Property Vector Store (individual property embeddings)
        4. PostgreSQL ExtractedProperty (structured property data with geocoding)
        
        Note: S3 and PostgreSQL Document table are handled separately in views.py
        """
        print(f"🗑️  Starting complete deletion for document {document_id}, business {business_id}")
        
        deletion_results = {
            'astra_tabular': False,
            'astra_document_vector': False,
            'astra_property_vector': False,
            'postgresql_properties': False
        }
        
        try:
            # 1. Delete from AstraDB tabular store
            deletion_results['astra_tabular'] = self.delete_tabular_data(document_id, business_id)
            print(f"✅ Tabular deletion: {deletion_results['astra_tabular']}")
            
            # 2. Delete from document vector store  
            deletion_results['astra_document_vector'] = self.delete_document_vector_data(document_id, business_id)
            print(f"✅ Document vector deletion: {deletion_results['astra_document_vector']}")
            
            # 3. Delete from property vector store
            deletion_results['astra_property_vector'] = self.delete_property_vector_data(document_id, business_id)
            print(f"✅ Property vector deletion: {deletion_results['astra_property_vector']}")
            
            # 4. Delete from PostgreSQL ExtractedProperty
            deletion_results['postgresql_properties'] = self.delete_postgresql_properties(document_id)
            print(f"✅ PostgreSQL properties deletion: {deletion_results['postgresql_properties']}")
            
            overall_success = all(deletion_results.values())
            success_count = sum(deletion_results.values())
            total_count = len(deletion_results)
            
            print(f"🎯 Overall deletion: {success_count}/{total_count} successful")
            
            return overall_success, deletion_results
            
        except Exception as e:
            print(f"❌ Error in complete deletion: {e}")
            return False, deletion_results
    
    def delete_document_from_astra_stores(self, document_id, business_id):
        """
        Legacy method for backward compatibility
        Delete document data from AstraDB tabular and document vector stores only
        """
        print(f"Starting AstraDB deletion for document {document_id}, business {business_id}")
        
        try:
            # Delete from tabular store
            tabular_success = self.delete_tabular_data(document_id, business_id)
            print(f"Tabular deletion result: {tabular_success}")
            
            # Delete from document vector store  
            vector_success = self.delete_document_vector_data(document_id, business_id)
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
            
            # First, find all record IDs that match our criteria
            find_query = f"SELECT id FROM {table_name} WHERE source_document_id = %s AND business_id = %s ALLOW FILTERING"
            result = session.execute(find_query, [uuid.UUID(str(document_id)), business_id])
            record_ids = [row.id for row in result]
            
            print(f"Found {len(record_ids)} records to delete from tabular store")
            
            if len(record_ids) == 0:
                print("No tabular records found - deletion successful (nothing to delete)")
                return True
            
            # Delete each record by its ID (partition key)
            delete_query = f"DELETE FROM {table_name} WHERE id = ?"
            prepared_delete = session.prepare(delete_query)
            
            deleted_count = 0
            for record_id in record_ids:
                try:
                    session.execute(prepared_delete, [record_id])
                    deleted_count += 1
                except Exception as e:
                    print(f"Error deleting record {record_id}: {e}")
            
            print(f"Successfully deleted {deleted_count} out of {len(record_ids)} records")
            
            # Verify deletion
            count_after = session.execute(find_query, [uuid.UUID(str(document_id)), business_id])
            remaining_count = len([row.id for row in count_after])
            print(f"Records remaining after deletion: {remaining_count}")
            
            return remaining_count == 0
            
        except Exception as e:
            print(f"Error deleting tabular data: {e}")
            return False
    
    def delete_document_vector_data(self, document_id, business_id):
        """Delete document chunks from AstraDB document vector store using Data API"""
        try:
            api_endpoint = os.environ["ASTRA_DB_VECTOR_API_ENDPOINT"]
            token = os.environ["ASTRA_DB_VECTOR_APPLICATION_TOKEN"]
            collection_name = "doc_vectors"  # Match the collection you created
            
            headers = {
                "Token": token,
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
    
    def delete_property_vector_data(self, document_id, business_id):
        """Delete individual property embeddings from AstraDB property vector store using Data API"""
        try:
            api_endpoint = os.environ["ASTRA_DB_COMP_API_ENDPOINT"]
            token = os.environ["ASTRA_DB_COMP_APPLICATION_TOKEN"]
            collection_name = f"properties_vectorized_{business_id.lower()}"
            
            headers = {
                "Token": token,
                "Content-Type": "application/json"
            }
            
            # Find properties with matching source document
            find_url = f"{api_endpoint}/api/json/v1/default_keyspace/{collection_name}/find"
            find_payload = {
                "filter": {
                    "metadata.source_document_id": str(document_id)
                },
                "options": {
                    "limit": 1000  # Adjust based on expected property count
                }
            }
            
            print(f"🔍 Searching for property vectors with document_id: {document_id}")
            response = requests.post(find_url, json=find_payload, headers=headers)
            
            if response.status_code != 200:
                print(f"⚠️  Error finding property vectors: {response.status_code} - {response.text}")
                # Don't fail if collection doesn't exist yet
                if "does not exist" in response.text.lower():
                    print("✅ Property vector collection doesn't exist yet - skipping")
                    return True
                return False
            
            documents = response.json().get("data", {}).get("documents", [])
            print(f"📋 Found {len(documents)} property vectors to delete")
            
            if not documents:
                print("✅ No property vectors found - deletion successful (nothing to delete)")
                return True
            
            # Delete each property by ID
            delete_count = 0
            delete_url_base = f"{api_endpoint}/api/json/v1/default_keyspace/{collection_name}"
            
            for doc in documents:
                doc_id = doc.get("_id")
                if doc_id:
                    delete_url = f"{delete_url_base}/{doc_id}"
                    delete_response = requests.delete(delete_url, headers=headers)
                    if delete_response.status_code == 200:
                        delete_count += 1
                        print(f"✅ Deleted property vector {doc_id}")
                    else:
                        print(f"❌ Failed to delete property vector {doc_id}: {delete_response.status_code}")
            
            print(f"📊 Successfully deleted {delete_count}/{len(documents)} property vectors")
            return delete_count == len(documents)
            
        except Exception as e:
            print(f"❌ Error deleting property vector data: {e}")
            return False
    
    def delete_postgresql_properties(self, document_id):
        """Delete extracted properties from PostgreSQL"""
        try:
            from ..models import ExtractedProperty, db
            from .. import create_app
            
            # Count properties before deletion
            properties = ExtractedProperty.query.filter_by(source_document_id=document_id).all()
            count_before = len(properties)
            print(f"📋 Found {count_before} properties to delete from PostgreSQL")
            
            if count_before == 0:
                print("✅ No PostgreSQL properties found - deletion successful (nothing to delete)")
                return True
            
            # Delete all properties
            for prop in properties:
                db.session.delete(prop)
            
            db.session.commit()
            
            # Verify deletion
            count_after = ExtractedProperty.query.filter_by(source_document_id=document_id).count()
            print(f"📊 Properties remaining after deletion: {count_after}")
            
            return count_after == 0
            
        except Exception as e:
            print(f"❌ Error deleting PostgreSQL properties: {e}")
            try:
                db.session.rollback()
            except:
                pass
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

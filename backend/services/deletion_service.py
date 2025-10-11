import os
import requests
import uuid
import logging
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

# Set up logging
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

class DeletionService:
    def __init__(self):
        self.tabular_session = None
        self.vector_store = None
        self.document_vector_index = None
        self.property_vector_index = None
    
    def delete_document_from_all_stores(self, document_id, business_id):
        """
        Delete document data from ALL databases in the 5-database architecture:
        1. AstraDB Tabular (comparable properties)
        2. AstraDB Document Vector Store (whole document chunks)
        3. AstraDB Property Vector Store (individual property embeddings)
        4. PostgreSQL ExtractedProperty (structured property data with geocoding)
        
        Note: S3 and PostgreSQL Document table are handled separately in views.py
        """
        logger.info("=" * 80)
        logger.info(f"DELETION SERVICE - Starting complete deletion")
        logger.info(f"Document ID: {document_id}")
        logger.info(f"Business ID: {business_id}")
        logger.info("=" * 80)
        
        deletion_results = {
            'astra_tabular': False,
            'astra_document_vector': False,
            'astra_property_vector': False,
            'postgresql_properties': False
        }
        
        deletion_errors = {
            'astra_tabular': None,
            'astra_document_vector': None,
            'astra_property_vector': None,
            'postgresql_properties': None
        }
        
        try:
            # 1. Delete from AstraDB tabular store
            logger.info("[1/4] Deleting from AstraDB Tabular Store...")
            try:
                deletion_results['astra_tabular'] = self.delete_tabular_data(document_id, business_id)
                if deletion_results['astra_tabular']:
                    logger.info("    SUCCESS: Tabular deletion")
                else:
                    logger.warning("    FAILED: Tabular deletion (returned False)")
            except Exception as e:
                deletion_errors['astra_tabular'] = str(e)
                logger.error(f"    ERROR: Tabular deletion - {e}")
            
            # 2. Delete from document vector store
            logger.info("[2/4] Deleting from Document Vector Store...")
            try:
                deletion_results['astra_document_vector'] = self.delete_document_vector_data(document_id, business_id)
                if deletion_results['astra_document_vector']:
                    logger.info("    SUCCESS: Document vector deletion")
                else:
                    logger.warning("    FAILED: Document vector deletion (returned False)")
            except Exception as e:
                deletion_errors['astra_document_vector'] = str(e)
                logger.error(f"    ERROR: Document vector deletion - {e}")
            
            # 3. Delete from property vector store
            logger.info("[3/4] Deleting from Property Vector Store...")
            try:
                deletion_results['astra_property_vector'] = self.delete_property_vector_data(document_id, business_id)
                if deletion_results['astra_property_vector']:
                    logger.info("    SUCCESS: Property vector deletion")
                else:
                    logger.warning("    FAILED: Property vector deletion (returned False)")
            except Exception as e:
                deletion_errors['astra_property_vector'] = str(e)
                logger.error(f"    ERROR: Property vector deletion - {e}")
            
            # 4. Delete from PostgreSQL ExtractedProperty
            logger.info("[4/4] Deleting from PostgreSQL ExtractedProperty...")
            try:
                deletion_results['postgresql_properties'] = self.delete_postgresql_properties(document_id)
                if deletion_results['postgresql_properties']:
                    logger.info("    SUCCESS: PostgreSQL properties deletion")
                else:
                    logger.warning("    FAILED: PostgreSQL properties deletion (returned False)")
            except Exception as e:
                deletion_errors['postgresql_properties'] = str(e)
                logger.error(f"    ERROR: PostgreSQL properties deletion - {e}")
            
            overall_success = all(deletion_results.values())
            success_count = sum(deletion_results.values())
            total_count = len(deletion_results)
            
            logger.info("=" * 80)
            logger.info(f"DELETION SUMMARY:")
            logger.info(f"   Success: {success_count}/{total_count}")
            logger.info(f"   Results: {deletion_results}")
            if any(deletion_errors.values()):
                logger.error(f"   Errors: {deletion_errors}")
            logger.info("=" * 80)
            
            return overall_success, deletion_results
            
        except Exception as e:
            logger.error(f"CRITICAL ERROR in complete deletion: {e}")
            import traceback
            traceback.print_exc()
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
        """Delete document chunks from AstraDB document vector store using REST API"""
        try:
            logger.info(f"Attempting to delete document vectors for document_id: {document_id}, business_id: {business_id}")
            
            # Use REST API directly for reliable deletion of ALL matching documents
            from .astra_utils import get_document_vector_client
            
            collection_name = os.environ["ASTRA_DB_VECTOR_COLLECTION_NAME"]
            client = get_document_vector_client()
            
            # Try multiple filter formats to find the correct one
            filter_variations = [
                {"document_id": str(document_id), "business_id": str(business_id)},
                {"metadata": {"document_id": str(document_id), "business_id": str(business_id)}},
                {"metadata.document_id": str(document_id), "metadata.business_id": str(business_id)}
            ]
            
            for i, filter_dict in enumerate(filter_variations, 1):
                logger.info(f"Trying filter variation {i}: {filter_dict}")
                deleted_count, total_found = client.delete_documents_by_filter(collection_name, filter_dict)
                
                if total_found > 0:
                    logger.info(f"SUCCESS with filter variation {i}: deleted {deleted_count}/{total_found} chunks")
                    return deleted_count == total_found
            
            logger.warning("No documents found with any filter variation - nothing to delete")
            return True  # Nothing to delete is considered success
            
        except Exception as e:
            logger.error(f"Error deleting document vector data: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def delete_property_vector_data(self, document_id, business_id):
        """Delete individual property embeddings from AstraDB property vector store using REST API"""
        try:
            collection_name = f"properties_vectorized_{business_id.lower()}"
            logger.info(f"Attempting to delete property vectors for document_id: {document_id}")
            
            # Use REST API directly for reliable deletion
            from .astra_utils import get_property_vector_client
            
            client = get_property_vector_client()
            
            # Check if collection exists
            if not client.collection_exists(collection_name):
                logger.info("Property vector collection doesn't exist yet - skipping")
                return True
            
            # Delete ALL properties matching filter
            filter_dict = {
                "metadata.source_document_id": str(document_id)
            }
            
            logger.info(f"Searching for property vectors with filter: {filter_dict}")
            deleted_count, total_found = client.delete_documents_by_filter(collection_name, filter_dict)
            
            if total_found == 0:
                logger.info("No property vectors found - deletion successful (nothing to delete)")
                return True
            
            logger.info(f"Property vector deletion: deleted {deleted_count}/{total_found} properties")
            return deleted_count == total_found
            
        except Exception as e:
            logger.error(f"Error deleting property vector data: {e}")
            import traceback
            traceback.print_exc()
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

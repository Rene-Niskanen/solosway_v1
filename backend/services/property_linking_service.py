"""
Property Linking Service for connecting documents to property nodes
"""
import logging
from typing import Dict, Any, Tuple, Optional
from sqlalchemy.orm import sessionmaker
from ..models import db, Property, Document
import uuid

logger = logging.getLogger(__name__)

class PropertyLinkingService:
    """Service for linking documents to property nodes and managing property relationships"""
    
    def __init__(self):
        pass
    
    def find_or_create_property(self, address_hash: str, address_data: Dict[str, Any], business_id: str) -> Tuple[Property, str]:
        """
        Find existing property or create new one based on address hash
        
        Args:
            address_hash: SHA256 hash of normalized address
            address_data: Complete address processing data
            business_id: Business identifier for multi-tenancy
            
        Returns:
            Tuple of (Property object, match_type)
        """
        try:
            # First, try to find exact hash match
            existing_property = Property.query.filter_by(
                address_hash=address_hash,
                business_id=business_id
            ).first()
            
            if existing_property:
                logger.info(f"Found existing property with exact hash match: {existing_property.id}")
                return existing_property, 'exact_match'
            
            # If no exact match, check for similar addresses (future: spatial proximity)
            # For now, create a new property
            new_property = self._create_new_property(address_hash, address_data, business_id)
            
            logger.info(f"Created new property: {new_property.id}")
            return new_property, 'new_property'
            
        except Exception as e:
            logger.error(f"Error in find_or_create_property: {e}")
            raise
    
    def _create_new_property(self, address_hash: str, address_data: Dict[str, Any], business_id: str) -> Property:
        """
        Create a new property node
        
        Args:
            address_hash: SHA256 hash of normalized address
            address_data: Complete address processing data
            business_id: Business identifier
            
        Returns:
            New Property object
        """
        try:
            new_property = Property(
                id=uuid.uuid4(),
                address_hash=address_hash,
                normalized_address=address_data.get('normalized_address'),
                formatted_address=address_data.get('formatted_address'),
                latitude=address_data.get('latitude'),
                longitude=address_data.get('longitude'),
                business_id=business_id
            )
            
            db.session.add(new_property)
            db.session.commit()
            
            logger.info(f"Created new property: {new_property.id} for address: {address_data.get('original_address')}")
            return new_property
            
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error creating new property: {e}")
            raise
    
    def link_document_to_property(self, document_id: str, property_id: str) -> bool:
        """
        Link a document to a property
        
        Args:
            document_id: Document UUID
            property_id: Property UUID
            
        Returns:
            Success status
        """
        try:
            document = Document.query.get(document_id)
            if not document:
                logger.error(f"Document not found: {document_id}")
                return False
            
            document.property_id = property_id
            db.session.commit()
            
            logger.info(f"Linked document {document_id} to property {property_id}")
            return True
            
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error linking document to property: {e}")
            return False
    
    
    def get_property_with_documents(self, property_id: str, business_id: str) -> Optional[Dict[str, Any]]:
        """
        Get property with all linked documents
        
        Args:
            property_id: Property UUID
            business_id: Business identifier
            
        Returns:
            Property data with documents or None
        """
        try:
            property_node = Property.query.filter_by(
                id=property_id,
                business_id=business_id
            ).first()
            
            if not property_node:
                logger.warning(f"Property not found: {property_id}")
                return None
            
            # Get all documents linked to this property
            documents = Document.query.filter_by(property_id=property_id).all()
            
            return {
                'property': property_node.serialize(),
                'documents': [doc.serialize() for doc in documents],
                'document_count': len(documents)
            }
            
        except Exception as e:
            logger.error(f"Error getting property with documents: {e}")
            return None
    
    def get_all_properties_for_business(self, business_id: str) -> list:
        """
        Get all properties for a business
        
        Args:
            business_id: Business identifier
            
        Returns:
            List of property data
        """
        try:
            properties = Property.query.filter_by(business_id=business_id).all()
            
            result = []
            for prop in properties:
                # Get document count for each property
                doc_count = Document.query.filter_by(property_id=prop.id).count()
                
                prop_data = prop.serialize()
                prop_data['document_count'] = doc_count
                result.append(prop_data)
            
            logger.info(f"Retrieved {len(result)} properties for business {business_id}")
            return result
            
        except Exception as e:
            logger.error(f"Error getting properties for business: {e}")
            return []
    
    def find_properties_by_address(self, address_query: str, business_id: str, limit: int = 10) -> list:
        """
        Find properties by address query (partial match)
        
        Args:
            address_query: Address search query
            business_id: Business identifier
            limit: Maximum results to return
            
        Returns:
            List of matching properties
        """
        try:
            # Search in both normalized and formatted addresses
            properties = Property.query.filter(
                Property.business_id == business_id,
                (
                    Property.normalized_address.ilike(f'%{address_query}%') |
                    Property.formatted_address.ilike(f'%{address_query}%')
                )
            ).limit(limit).all()
            
            result = []
            for prop in properties:
                doc_count = Document.query.filter_by(property_id=prop.id).count()
                prop_data = prop.serialize()
                prop_data['document_count'] = doc_count
                result.append(prop_data)
            
            logger.info(f"Found {len(result)} properties matching '{address_query}'")
            return result
            
        except Exception as e:
            logger.error(f"Error finding properties by address: {e}")
            return []
    
    def get_property_statistics(self, business_id: str) -> Dict[str, Any]:
        """
        Get statistics for properties in a business
        
        Args:
            business_id: Business identifier
            
        Returns:
            Statistics dictionary
        """
        try:
            total_properties = Property.query.filter_by(business_id=business_id).count()
            total_documents = Document.query.filter_by(business_id=business_id).count()
            
            # Properties with documents
            properties_with_docs = db.session.query(Property).join(Document).filter(
                Property.business_id == business_id
            ).distinct().count()
            
            # Properties with geocoding
            properties_geocoded = Property.query.filter(
                Property.business_id == business_id,
                Property.latitude.isnot(None),
                Property.longitude.isnot(None)
            ).count()
            
            return {
                'total_properties': total_properties,
                'total_documents': total_documents,
                'properties_with_documents': properties_with_docs,
                'properties_geocoded': properties_geocoded,
                'geocoding_percentage': (properties_geocoded / total_properties * 100) if total_properties > 0 else 0,
                'document_linkage_percentage': (properties_with_docs / total_properties * 100) if total_properties > 0 else 0
            }
            
        except Exception as e:
            logger.error(f"Error getting property statistics: {e}")
            return {}
    
    def merge_properties(self, primary_property_id: str, secondary_property_id: str, business_id: str) -> bool:
        """
        Merge two properties (move all documents from secondary to primary)
        
        Args:
            primary_property_id: UUID of primary property
            secondary_property_id: UUID of property to merge
            business_id: Business identifier
            
        Returns:
            Success status
        """
        try:
            # Verify both properties exist and belong to business
            primary_prop = Property.query.filter_by(
                id=primary_property_id,
                business_id=business_id
            ).first()
            
            secondary_prop = Property.query.filter_by(
                id=secondary_property_id,
                business_id=business_id
            ).first()
            
            if not primary_prop or not secondary_prop:
                logger.error("One or both properties not found")
                return False
            
            # Move all documents from secondary to primary
            documents_moved = Document.query.filter_by(
                property_id=secondary_property_id
            ).update({'property_id': primary_property_id})
            
            # Delete secondary property
            db.session.delete(secondary_prop)
            db.session.commit()
            
            logger.info(f"Merged properties: moved {documents_moved} documents")
            return True
            
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error merging properties: {e}")
            return False

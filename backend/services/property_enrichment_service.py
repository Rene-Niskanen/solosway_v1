from typing import Dict, List, Any, Optional
from datetime import datetime
import logging

from .supabase_client_factory import get_supabase_client

logger = logging.getLogger(__name__)

class PropertyEnrichmentService:
    """Service for enriching property data from multiple documents"""
    
    # Field priority by document type
    FIELD_PRIORITIES = {
        'valuation_report': 1,    # Highest priority
        'market_appraisal': 2,
        'lease_agreement': 3,
        'other_documents': 4      # Lowest priority
    }
    
    # Required fields for a "complete" property
    REQUIRED_FIELDS = [
        'property_address',
        'property_type',
        'size_sqft',
        'number_bedrooms',
        'number_bathrooms'
    ]
    
    def enrich_property_from_extracted_data(
        self, 
        property_id: str,
        extracted_data: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Enrich property data by merging multiple extractions
        
        Args:
            property_id: Property UUID
            extracted_data: List of extracted property data dicts
            
        Returns:
            Enriched property data with source tracking
        """
        # Sort by document priority
        sorted_data = sorted(
            extracted_data,
            key=lambda x: self.FIELD_PRIORITIES.get(
                x.get('source_document_type'), 999
            )
        )
        
        # Start with empty enriched data
        enriched_data = {}
        data_sources = {}  # Track where each field came from
        
        # Merge data, giving priority to higher priority documents
        for data in sorted_data:
            doc_type = data.get('source_document_type')
            doc_id = data.get('source_document_id')
            
            for field, value in data.items():
                # Skip null/empty values
                if value is None or value == '':
                    continue
                    
                # Skip metadata fields
                if field in ['source_document_id', 'source_document_type']:
                    continue
                
                # Only update if:
                # 1. Field doesn't exist yet, OR
                # 2. New value is from higher priority document
                if (
                    field not in enriched_data or
                    self.FIELD_PRIORITIES.get(doc_type, 999) < 
                    self.FIELD_PRIORITIES.get(data_sources[field]['type'], 999)
                ):
                    enriched_data[field] = value
                    data_sources[field] = {
                        'type': doc_type,
                        'document_id': doc_id,
                        'updated_at': datetime.utcnow()
                    }
        
        return {
            'enriched_data': enriched_data,
            'data_sources': data_sources,
            'completeness_score': self.calculate_completeness(enriched_data)
        }
    
    def calculate_completeness(self, data: Dict[str, Any]) -> float:
        """Calculate property data completeness score (0.0 to 1.0)"""
        # Required fields count more
        required_score = sum(
            1 for field in self.REQUIRED_FIELDS 
            if data.get(field) is not None
        ) / len(self.REQUIRED_FIELDS)
        
        # Optional fields
        total_fields = len(data)
        filled_fields = sum(1 for v in data.values() if v is not None)
        optional_score = filled_fields / total_fields if total_fields > 0 else 0
        
        # Weight required fields more heavily
        return (required_score * 0.7) + (optional_score * 0.3)
    
    def get_property_completeness(self, property_id: str) -> Dict[str, Any]:
        """Get property completeness report from Supabase property_details"""
        from ..models import Property
        
        property_node = Property.query.get(property_id)
        if not property_node:
            return {'error': 'Property not found'}
        
        # Get property data from Supabase property_details
        try:
            supabase = get_supabase_client()
            
            # Get comparable properties for this property
            result = supabase.table('property_details').select('*').eq('property_id', property_id).execute()
            properties = result.data if result.data else []
            
            if not properties:
                return {
                    'property_id': str(property_id),
                    'normalized_address': property_node.normalized_address,
                    'document_count': 0,
                    'completeness_score': 0.0,
                    'missing_required_fields': self.REQUIRED_FIELDS,
                    'data_sources': {}
                }
            
            # Use the first property data for completeness calculation
            property_data = properties[0]
            completeness_score = self.calculate_completeness(property_data)
            
            return {
                'property_id': str(property_id),
                'normalized_address': property_node.normalized_address,
                'document_count': len(properties),
                'completeness_score': completeness_score,
                'missing_required_fields': [
                    field for field in self.REQUIRED_FIELDS
                    if not property_data.get(field)
                ],
                'data_sources': {'supabase': 'property_details'}
            }
            
        except Exception as e:
            return {
                'property_id': str(property_id),
                'error': f'Failed to get completeness data: {str(e)}',
                'completeness_score': 0.0
            }
    
    def get_most_complete_property_data(
        self, 
        property_id: str
    ) -> Dict[str, Any]:
        """Get the most complete/accurate data for a property from Supabase"""
        from ..models import Property
        
        # Get property node
        property_node = Property.query.get(property_id)
        if not property_node:
            return {'error': 'Property not found'}
        
        # Get property data from Supabase property_details
        try:
            supabase = get_supabase_client()
            
            # Get comparable properties for this property
            result = supabase.table('property_details').select('*').eq('property_id', property_id).execute()
            properties = result.data if result.data else []
            
            if not properties:
                return {
                    'property_id': str(property_id),
                    'normalized_address': property_node.normalized_address,
                    'formatted_address': property_node.formatted_address,
                    'latitude': property_node.latitude,
                    'longitude': property_node.longitude,
                    'enriched_data': {},
                    'completeness_score': 0.0,
                    'data_sources': {},
                    'document_count': 0
                }
            
            # Use the first property data (most recent)
            property_data = properties[0]
            completeness_score = self.calculate_completeness(property_data)
            
            return {
                'property_id': str(property_id),
                'normalized_address': property_node.normalized_address,
                'formatted_address': property_node.formatted_address,
                'latitude': property_node.latitude,
                'longitude': property_node.longitude,
                'enriched_data': property_data,
                'completeness_score': completeness_score,
                'data_sources': {'supabase': 'property_details'},
                'document_count': len(properties)
            }
            
        except Exception as e:
            return {
                'property_id': str(property_id),
                'error': f'Failed to get property data: {str(e)}',
                'completeness_score': 0.0
            }
"""
API Response Formatter Service
Standardizes API responses across all endpoints
"""
from typing import Dict, Any, List, Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class APIResponseFormatter:
    """Service for standardizing API responses"""
    
    @staticmethod
    def format_success_response(data: Any = None, message: str = "Success", 
                               metadata: Optional[Dict] = None) -> Dict[str, Any]:
        """Format successful API response"""
        response = {
            'success': True,
            'message': message,
            'timestamp': datetime.utcnow().isoformat()
        }
        
        if data is not None:
            response['data'] = data
        
        if metadata:
            response['metadata'] = metadata
            
        return response
    
    @staticmethod
    def format_property_hubs_response(property_hubs: List[Dict], 
                                    pagination: Optional[Dict] = None,
                                    filters_applied: Optional[Dict] = None) -> Dict[str, Any]:
        """Format property hubs response with proper structure"""
        response = {
            'success': True,
            'properties': property_hubs,  # Fixed: was 'data'
            'timestamp': datetime.utcnow().isoformat()
        }
        
        # Add pagination if provided
        if pagination:
            response['pagination'] = {
                'page': pagination.get('page', 1),
                'limit': pagination.get('limit', 100),
                'total': pagination.get('total', len(property_hubs)),
                'pages': pagination.get('pages', 1),
                'has_next': pagination.get('has_next', False),
                'has_prev': pagination.get('has_prev', False)
            }
        else:
            response['pagination'] = {
                'page': 1,
                'limit': len(property_hubs),
                'total': len(property_hubs),
                'pages': 1,
                'has_next': False,
                'has_prev': False
            }
        
        # Add filters applied if provided
        if filters_applied:
            response['filters_applied'] = filters_applied
        
        # Add metadata
        response['metadata'] = {
            'count': len(property_hubs),
            'timestamp': datetime.utcnow().isoformat()
        }
        
        return response
    
    @staticmethod
    def format_search_response(results: List[Dict], query: str, 
                             filters: Optional[Dict] = None,
                             pagination: Optional[Dict] = None) -> Dict[str, Any]:
        """Format search response with proper structure"""
        response = {
            'success': True,
            'properties': results,  # Fixed: was 'data'
            'search_metadata': {
                'query': query,
                'results_count': len(results),
                'timestamp': datetime.utcnow().isoformat()
            }
        }
        
        # Add pagination if provided
        if pagination:
            response['pagination'] = {
                'page': pagination.get('page', 1),
                'limit': pagination.get('limit', 100),
                'total': pagination.get('total', len(results)),
                'pages': pagination.get('pages', 1),
                'has_next': pagination.get('has_next', False),
                'has_prev': pagination.get('has_prev', False)
            }
        
        # Add filters applied if provided
        if filters:
            response['filters_applied'] = filters
        
        return response
    
    @staticmethod
    def format_error_response(error: str, error_code: str = "GENERIC_ERROR",
                            status_code: int = 400, 
                            details: Optional[Dict] = None) -> Dict[str, Any]:
        """Format error response"""
        response = {
            'success': False,
            'error': error,
            'error_code': error_code,
            'timestamp': datetime.utcnow().isoformat()
        }
        
        if details:
            response['details'] = details
            
        return response
    
    @staticmethod
    def format_validation_error_response(errors: List[str], 
                                       field_errors: Optional[Dict] = None) -> Dict[str, Any]:
        """Format validation error response"""
        response = {
            'success': False,
            'error': 'Validation failed',
            'error_code': 'VALIDATION_ERROR',
            'errors': errors,
            'timestamp': datetime.utcnow().isoformat()
        }
        
        if field_errors:
            response['field_errors'] = field_errors
            
        return response
    
    @staticmethod
    def format_health_response(status: str, checks: Dict[str, Any],
                              performance: Optional[Dict] = None) -> Dict[str, Any]:
        """Format health check response"""
        response = {
            'status': status,
            'timestamp': datetime.utcnow().isoformat(),
            'checks': checks
        }
        
        if performance:
            response['performance'] = performance
            
        return response
    
    @staticmethod
    def format_list_response(items: List[Dict], item_type: str = "items",
                           pagination: Optional[Dict] = None) -> Dict[str, Any]:
        """Format generic list response"""
        response = {
            'success': True,
            item_type: items,
            'count': len(items),
            'timestamp': datetime.utcnow().isoformat()
        }
        
        if pagination:
            response['pagination'] = pagination
            
        return response
    
    @staticmethod
    def format_document_response(document: Dict, 
                               related_data: Optional[Dict] = None) -> Dict[str, Any]:
        """Format document response with related data"""
        response = {
            'success': True,
            'document': document,
            'timestamp': datetime.utcnow().isoformat()
        }
        
        if related_data:
            response.update(related_data)
            
        return response
    
    @staticmethod
    def format_property_hub_response(property_hub: Dict) -> Dict[str, Any]:
        """Format single property hub response"""
        return {
            'success': True,
            'property_hub': property_hub,
            'timestamp': datetime.utcnow().isoformat()
        }
    
    @staticmethod
    def format_analytics_response(analytics_data: Dict) -> Dict[str, Any]:
        """Format analytics response"""
        return {
            'success': True,
            'analytics': analytics_data,
            'timestamp': datetime.utcnow().isoformat()
        }
    
    @staticmethod
    def format_upload_response(upload_result: Dict) -> Dict[str, Any]:
        """Format file upload response"""
        return {
            'success': upload_result.get('success', False),
            'message': upload_result.get('message', 'Upload completed'),
            'upload_data': upload_result,
            'timestamp': datetime.utcnow().isoformat()
        }

#!/usr/bin/env python3
"""
Day 8: Performance Optimization for SupabasePropertyHubService
Optimized query methods and caching strategies
"""

import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
import uuid
from functools import lru_cache
import time

from .supabase_client_factory import get_supabase_client

# Setup logging
logger = logging.getLogger(__name__)

class OptimizedSupabasePropertyHubService:
    """
    Optimized version of SupabasePropertyHubService with performance improvements
    """
    
    def __init__(self):
        """Initialize optimized service with connection pooling"""
        try:
            self.supabase = get_supabase_client()
            logger.info("✅ Optimized SupabasePropertyHubService initialized")
            
            # Performance tracking
            self.query_stats = {
                'total_queries': 0,
                'total_time': 0,
                'cache_hits': 0,
                'cache_misses': 0
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize optimized service: {e}")
            raise
    
    def _track_query_performance(self, query_name: str, execution_time: float, cache_hit: bool = False):
        """Track query performance metrics"""
        self.query_stats['total_queries'] += 1
        self.query_stats['total_time'] += execution_time
        
        if cache_hit:
            self.query_stats['cache_hits'] += 1
        else:
            self.query_stats['cache_misses'] += 1
        
        logger.debug(f"Query '{query_name}' executed in {execution_time:.2f}ms (cache: {'hit' if cache_hit else 'miss'})")
    
    @lru_cache(maxsize=100)
    def _get_business_properties_cached(self, business_id: str, cache_key: str):
        """Cached method to get business properties"""
        start_time = time.time()
        
        try:
            # Optimized query with only necessary fields
            result = self.supabase.table('properties').select(
                'id, formatted_address, normalized_address, latitude, longitude, '
                'geocoding_status, geocoding_confidence, created_at, updated_at'
            ).eq('business_id', business_id).order('created_at', desc=True).execute()
            
            execution_time = (time.time() - start_time) * 1000
            self._track_query_performance('get_business_properties', execution_time, cache_hit=True)
            
            return result.data if result.data else []
            
        except Exception as e:
            logger.error(f"❌ Error getting business properties: {e}")
            return []
    
    def get_business_properties_optimized(self, business_id: str) -> List[Dict[str, Any]]:
        """Optimized method to get business properties with caching"""
        # Create cache key based on business_id and current hour (cache for 1 hour)
        cache_key = f"{business_id}_{datetime.now().strftime('%Y%m%d%H')}"
        
        return self._get_business_properties_cached(business_id, cache_key)
    
    def get_property_details_batch(self, property_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """Optimized batch retrieval of property details"""
        start_time = time.time()
        
        try:
            if not property_ids:
                return {}
            
            # Use IN clause for batch retrieval
            result = self.supabase.table('property_details').select('*').in_('property_id', property_ids).execute()
            
            execution_time = (time.time() - start_time) * 1000
            self._track_query_performance('get_property_details_batch', execution_time)
            
            # Convert to dictionary for O(1) lookup
            details_map = {}
            if result.data:
                for detail in result.data:
                    details_map[detail['property_id']] = detail
            
            logger.debug(f"Retrieved {len(details_map)} property details in {execution_time:.2f}ms")
            return details_map
            
        except Exception as e:
            logger.error(f"❌ Error getting property details batch: {e}")
            return {}
    
    def get_document_relationships_batch(self, property_ids: List[str]) -> Dict[str, List[Dict[str, Any]]]:
        """Optimized batch retrieval of document relationships"""
        start_time = time.time()
        
        try:
            if not property_ids:
                return {}
            
            # Use IN clause for batch retrieval
            result = self.supabase.table('document_relationships').select(
                'property_id, document_id, relationship_type, confidence_score, created_at'
            ).in_('property_id', property_ids).execute()
            
            execution_time = (time.time() - start_time) * 1000
            self._track_query_performance('get_document_relationships_batch', execution_time)
            
            # Group by property_id
            relationships_map = {}
            if result.data:
                for rel in result.data:
                    prop_id = rel['property_id']
                    if prop_id not in relationships_map:
                        relationships_map[prop_id] = []
                    relationships_map[prop_id].append(rel)
            
            logger.debug(f"Retrieved relationships for {len(relationships_map)} properties in {execution_time:.2f}ms")
            return relationships_map
            
        except Exception as e:
            logger.error(f"❌ Error getting document relationships batch: {e}")
            return {}
    
    def get_documents_batch(self, document_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """Optimized batch retrieval of documents"""
        start_time = time.time()
        
        try:
            if not document_ids:
                return {}
            
            # Use IN clause for batch retrieval - include s3_path for document preview
            result = self.supabase.table('documents').select(
                'id, original_filename, s3_path, file_type, file_size, status, classification_type, created_at, updated_at'
            ).in_('id', document_ids).execute()
            
            execution_time = (time.time() - start_time) * 1000
            self._track_query_performance('get_documents_batch', execution_time)
            
            # Convert to dictionary for O(1) lookup
            documents_map = {}
            if result.data:
                for doc in result.data:
                    documents_map[doc['id']] = doc
            
            logger.debug(f"Retrieved {len(documents_map)} documents in {execution_time:.2f}ms")
            return documents_map
            
        except Exception as e:
            logger.error(f"❌ Error getting documents batch: {e}")
            return {}
    
    def get_all_property_hubs_optimized(
        self, 
        business_id: str, 
        limit: int = 100, 
        offset: int = 0,
        sort_by: str = 'created_at',
        sort_order: str = 'desc'
    ) -> List[Dict[str, Any]]:
        """
        Optimized method to get all property hubs with batch operations
        
        Args:
            business_id: Business identifier
            limit: Maximum number of results
            offset: Number of results to skip
            sort_by: Field to sort by (created_at, updated_at, completeness_score, formatted_address)
            sort_order: Sort order (asc, desc)
        """
        start_time = time.time()
        
        try:
            logger.info(f"🏠 Getting property hubs (optimized) for business: {business_id}")
            
            # Validate sort parameters
            valid_sort_fields = ['created_at', 'updated_at', 'completeness_score', 'formatted_address']
            if sort_by not in valid_sort_fields:
                logger.warning(f"Invalid sort_by '{sort_by}', defaulting to 'created_at'")
                sort_by = 'created_at'
            
            if sort_order not in ['asc', 'desc']:
                logger.warning(f"Invalid sort_order '{sort_order}', defaulting to 'desc'")
                sort_order = 'desc'
            
            # Step 1: Get properties with pagination and sorting
            # Support both business_id and business_uuid (normalize if needed)
            # Note: If sorting by completeness_score, we'll need to sort after fetching (it's calculated)
            needs_post_sort = sort_by == 'completeness_score'
            
            if needs_post_sort:
                # For completeness_score, we need to fetch more properties to sort properly
                # We must fetch enough properties to cover the offset + limit range after sorting
                # Fetch with a buffer (2x) to account for potential reordering during sort
                # This ensures we have enough data to return the requested page
                required_count = offset + limit
                fetch_limit = min(required_count * 2, 1000)  # Fetch 2x the required count or max 1000
                # Ensure we fetch at least enough to cover the offset + limit
                fetch_limit = max(fetch_limit, required_count)
                logger.info(f"   📊 Post-sorting required: fetching {fetch_limit} properties to cover offset={offset}, limit={limit}")
                properties_query = (
                    self.supabase.table('properties')
                    .select('id, formatted_address, normalized_address, latitude, longitude, '
                            'geocoding_status, geocoding_confidence, created_at, updated_at')
                    .eq('business_uuid', business_id)
                    .order('created_at', desc=True)  # Default sort for initial fetch
                    .range(0, fetch_limit - 1)
                )
            else:
                # For database fields (created_at, updated_at, formatted_address), we can sort directly in the query
                properties_query = (
                    self.supabase.table('properties')
                    .select('id, formatted_address, normalized_address, latitude, longitude, '
                            'geocoding_status, geocoding_confidence, created_at, updated_at')
                    .eq('business_uuid', business_id)
                    .order(sort_by, desc=(sort_order == 'desc'))
                    .range(offset, offset + limit - 1)
                )
            
            properties_result = properties_query.execute()
            
            if not properties_result.data:
                logger.info(f"   ⚠️ No properties found for business: {business_id}")
                return []
            
            property_ids = [prop['id'] for prop in properties_result.data]
            logger.info(f"   📊 Found {len(property_ids)} properties")
            
            # Step 2: Batch retrieve all related data
            property_details_map = self.get_property_details_batch(property_ids)
            relationships_map = self.get_document_relationships_batch(property_ids)
            
            # Step 3: Get all document IDs
            all_document_ids = []
            for prop_id, relationships in relationships_map.items():
                all_document_ids.extend([rel['document_id'] for rel in relationships])
            
            documents_map = self.get_documents_batch(all_document_ids)
            
            # Step 4: Build property hubs
            property_hubs = []
            for prop in properties_result.data:
                prop_id = prop['id']
                
                # Get property details
                property_details = property_details_map.get(prop_id)
                
                # Get documents for this property
                property_documents = []
                if prop_id in relationships_map:
                    for rel in relationships_map[prop_id]:
                        doc_id = rel['document_id']
                        if doc_id in documents_map:
                            doc = documents_map[doc_id].copy()
                            doc['relationship_type'] = rel['relationship_type']
                            doc['confidence_score'] = rel['confidence_score']
                            property_documents.append(doc)
                
                # Build property hub (match format expected by frontend)
                property_hub = {
                    'property': prop,
                    'property_details': property_details or {},
                    'documents': property_documents,
                    'comparable_data': [],  # Empty for now - can be added if needed
                    'property_history': [],  # Empty for now - can be added if needed
                    'vectors': {
                        'document_vectors_count': 0,  # Would need separate query
                        'property_vectors_count': 0  # Would need separate query
                    },
                    'summary': {
                        'document_count': len(property_documents),
                        'has_details': bool(property_details),
                        'has_comparable_data': False,
                        'has_vectors': False,
                        'completeness_score': self._calculate_completeness_score(prop, property_details),
                        'total_records': len(property_documents)
                    }
                }
                
                property_hubs.append(property_hub)
            
            # Step 5: Apply post-sorting if needed (for completeness_score which is calculated)
            if needs_post_sort:
                # Sort by completeness_score (calculated field)
                reverse = sort_order == 'desc'
                property_hubs.sort(
                    key=lambda hub: hub['summary'].get('completeness_score', 0),
                    reverse=reverse
                )
                # Apply pagination after sorting
                # Check if we have enough properties to satisfy the offset
                if offset >= len(property_hubs):
                    # Requested offset is beyond available data
                    logger.warning(f"   ⚠️ Offset {offset} exceeds available properties ({len(property_hubs)}), returning empty result")
                    property_hubs = []
                else:
                    # Slice to get the requested page
                    property_hubs = property_hubs[offset:offset + limit]
                logger.info(f"   📊 Sorted by {sort_by} ({sort_order}), applied pagination: {len(property_hubs)} results (offset={offset}, limit={limit})")
            # For created_at, updated_at, and formatted_address, sorting is already done in the database query
            
            execution_time = (time.time() - start_time) * 1000
            self._track_query_performance('get_all_property_hubs_optimized', execution_time)
            
            logger.info(f"   ✅ Built {len(property_hubs)} property hubs in {execution_time:.2f}ms")
            return property_hubs
            
        except Exception as e:
            logger.error(f"❌ Error getting property hubs (optimized): {e}")
            return []
    
    def search_property_hubs_optimized(self, business_id: str, query: str = None, 
                                     filters: Dict[str, Any] = None, limit: int = 50) -> List[Dict[str, Any]]:
        """
        Optimized property hub search with efficient filtering
        """
        start_time = time.time()
        
        try:
            logger.info(f"🔍 Searching property hubs (optimized) for business: {business_id}")
            
            # Build optimized query
            query_builder = self.supabase.table('properties').select(
                'id, formatted_address, normalized_address, latitude, longitude, '
                'geocoding_status, geocoding_confidence, created_at, updated_at'
            ).eq('business_id', business_id)
            
            # Apply text search if provided
            if query and query.strip():
                query_builder = query_builder.or_(
                    f'formatted_address.ilike.%{query}%,'
                    f'normalized_address.ilike.%{query}%'
                )
            
            # Apply geocoding filter (only successfully geocoded properties)
            query_builder = query_builder.eq('geocoding_status', 'success')
            
            # Execute query with limit
            result = query_builder.limit(limit).order('created_at', desc=True).execute()
            
            if not result.data:
                logger.info(f"   ⚠️ No properties found matching search criteria")
                return []
            
            property_ids = [prop['id'] for prop in result.data]
            logger.info(f"   📊 Found {len(property_ids)} properties matching search")
            
            # Batch retrieve property details for filtering
            property_details_map = self.get_property_details_batch(property_ids)
            
            # Apply filters to property details
            filtered_property_ids = []
            for prop_id in property_ids:
                details = property_details_map.get(prop_id)
                if self._matches_filters(details, filters):
                    filtered_property_ids.append(prop_id)
            
            if not filtered_property_ids:
                logger.info(f"   ⚠️ No properties match the applied filters")
                return []
            
            # Get remaining data for filtered properties
            filtered_properties = [prop for prop in result.data if prop['id'] in filtered_property_ids]
            relationships_map = self.get_document_relationships_batch(filtered_property_ids)
            
            # Get documents
            all_document_ids = []
            for prop_id, relationships in relationships_map.items():
                all_document_ids.extend([rel['document_id'] for rel in relationships])
            
            documents_map = self.get_documents_batch(all_document_ids)
            
            # Build property hubs
            property_hubs = []
            for prop in filtered_properties:
                prop_id = prop['id']
                
                property_details = property_details_map.get(prop_id)
                property_documents = []
                
                if prop_id in relationships_map:
                    for rel in relationships_map[prop_id]:
                        doc_id = rel['document_id']
                        if doc_id in documents_map:
                            doc = documents_map[doc_id].copy()
                            doc['relationship_type'] = rel['relationship_type']
                            doc['confidence_score'] = rel['confidence_score']
                            property_documents.append(doc)
                
                property_hub = {
                    'property': prop,
                    'property_details': property_details,
                    'documents': property_documents,
                    'summary': {
                        'total_documents': len(property_documents),
                        'completeness_score': self._calculate_completeness_score(prop, property_details)
                    }
                }
                
                property_hubs.append(property_hub)
            
            execution_time = (time.time() - start_time) * 1000
            self._track_query_performance('search_property_hubs_optimized', execution_time)
            
            logger.info(f"   ✅ Found {len(property_hubs)} matching property hubs in {execution_time:.2f}ms")
            return property_hubs
            
        except Exception as e:
            logger.error(f"❌ Error searching property hubs (optimized): {e}")
            return []
    
    def _matches_filters(self, property_details: Optional[Dict], filters: Dict[str, Any]) -> bool:
        """Check if property details match the given filters"""
        if not filters or not property_details:
            return True
        
        # Property type filter
        if 'property_type' in filters and filters['property_type']:
            if property_details.get('property_type') != filters['property_type']:
                return False
        
        # Price filters
        if 'min_price' in filters and filters['min_price']:
            asking_price = property_details.get('asking_price')
            if asking_price and asking_price < filters['min_price']:
                return False
        
        if 'max_price' in filters and filters['max_price']:
            asking_price = property_details.get('asking_price')
            if asking_price and asking_price > filters['max_price']:
                return False
        
        # Bedroom filters
        if 'min_bedrooms' in filters and filters['min_bedrooms']:
            bedrooms = property_details.get('number_bedrooms')
            if bedrooms and bedrooms < filters['min_bedrooms']:
                return False
        
        if 'max_bedrooms' in filters and filters['max_bedrooms']:
            bedrooms = property_details.get('number_bedrooms')
            if bedrooms and bedrooms > filters['max_bedrooms']:
                return False
        
        # Tenure filter
        if 'tenure' in filters and filters['tenure']:
            if property_details.get('tenure') != filters['tenure']:
                return False
        
        return True
    
    def _calculate_completeness_score(self, property: Dict, property_details: Optional[Dict]) -> float:
        """Calculate completeness score for a property"""
        score = 0.0
        total_fields = 0
        
        # Property fields
        property_fields = ['formatted_address', 'latitude', 'longitude', 'geocoding_status']
        for field in property_fields:
            total_fields += 1
            if property.get(field):
                score += 1
        
        # Property details fields
        if property_details:
            details_fields = ['property_type', 'size_sqft', 'number_bedrooms', 'number_bathrooms', 'asking_price']
            for field in details_fields:
                total_fields += 1
                if property_details.get(field):
                    score += 1
        
        return score / total_fields if total_fields > 0 else 0.0
    
    def get_performance_stats(self) -> Dict[str, Any]:
        """Get performance statistics"""
        avg_time = self.query_stats['total_time'] / self.query_stats['total_queries'] if self.query_stats['total_queries'] > 0 else 0
        
        return {
            'total_queries': self.query_stats['total_queries'],
            'average_query_time': avg_time,
            'cache_hit_rate': (self.query_stats['cache_hits'] / self.query_stats['total_queries'] * 100) if self.query_stats['total_queries'] > 0 else 0,
            'total_execution_time': self.query_stats['total_time']
        }
    
    def clear_cache(self):
        """Clear all caches"""
        self._get_business_properties_cached.cache_clear()
        logger.info("✅ Cache cleared")

def test_optimized_service():
    """Test the optimized service"""
    try:
        service = OptimizedSupabasePropertyHubService()
        
        print("🚀 Testing Optimized SupabasePropertyHubService")
        print("=" * 60)
        
        # Test 1: Get all property hubs
        print("📋 Test 1: Get all property hubs (optimized)")
        start_time = time.time()
        hubs = service.get_all_property_hubs_optimized("test_business", limit=10)
        execution_time = (time.time() - start_time) * 1000
        
        print(f"   ✅ Retrieved {len(hubs)} property hubs in {execution_time:.2f}ms")
        
        # Test 2: Search property hubs
        print("\n📋 Test 2: Search property hubs (optimized)")
        start_time = time.time()
        search_results = service.search_property_hubs_optimized(
            "test_business", 
            query="London",
            filters={"property_type": "House"}
        )
        execution_time = (time.time() - start_time) * 1000
        
        print(f"   ✅ Found {len(search_results)} matching properties in {execution_time:.2f}ms")
        
        # Test 3: Performance stats
        print("\n📋 Test 3: Performance statistics")
        stats = service.get_performance_stats()
        print(f"   Total Queries: {stats['total_queries']}")
        print(f"   Average Query Time: {stats['average_query_time']:.2f}ms")
        print(f"   Cache Hit Rate: {stats['cache_hit_rate']:.1f}%")
        
        print("\n🎉 Optimized service testing completed!")
        return True
        
    except Exception as e:
        print(f"❌ Optimized service test failed: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    test_optimized_service()

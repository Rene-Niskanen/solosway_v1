from ..models import Document, db
from datetime import datetime, timedelta
from sqlalchemy import func, desc
import logging
from typing import Dict, Any, List, Optional

from .supabase_client_factory import get_supabase_client

logger = logging.getLogger(__name__)

class AnalyticsService:
    def log_activity(self, user_id: int, activity_type: str, details: Dict[str, Any]) -> Dict[str, Any]:
        """
        Log user activity.
        
        Args:
            user_id: User ID
            activity_type: Type of activity (e.g., 'search', 'upload', 'download')
            details: Additional activity details
            
        Returns:
            Dictionary with logging result
        """
        logger.info(f"AnalyticsService: Logging activity for user {user_id}: {activity_type} - {details}")
        
        # TODO: In production, store in a dedicated Activity table
        # For now, just return success
        return {
            "logged": True,
            "timestamp": datetime.utcnow().isoformat(),
            "user_id": user_id,
            "activity_type": activity_type,
            "details": details
        }
    
    def get_analytics(self, business_id: str, filters: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Get comprehensive analytics summary for business.
        
        Args:
            business_id: Business identifier
            filters: Optional filters for date range, etc.
            
        Returns:
            Dictionary with analytics data
        """
        logger.info(f"AnalyticsService: Getting analytics for business {business_id} with filters {filters}")
        
        try:
            # Apply date filters if provided
            date_filter = None
            if filters and filters.get('start_date'):
                date_filter = datetime.fromisoformat(filters['start_date'].replace('Z', '+00:00'))
            elif filters and filters.get('days_back'):
                date_filter = datetime.utcnow() - timedelta(days=filters['days_back'])
            
            # Base queries
            doc_query = Document.query.filter_by(business_id=business_id)
            
            if date_filter:
                doc_query = doc_query.filter(Document.created_at >= date_filter)
            
            # Basic counts
            doc_count = doc_query.count()
            
            # Get Supabase property count
            supabase = None
            try:
                supabase = get_supabase_client()
                supabase_result = supabase.table('property_details').select('property_id', count='exact').eq('business_id', business_id).execute()
                prop_count = supabase_result.count if supabase_result.count is not None else 0
                
            except Exception as e:
                prop_count = 0
            
            # Document statistics
            recent_docs = doc_query.order_by(desc(Document.created_at)).limit(5).all()
            
            # Document status breakdown
            status_counts = {}
            for status in ['UPLOADED', 'PROCESSING', 'COMPLETED', 'FAILED']:
                status_counts[status.lower()] = doc_query.filter(
                    Document.status == status
                ).count()
            
            # Property statistics from Supabase
            property_stats = {}
            price_ranges = {}
            property_type_counts = {}
            bedroom_distribution = {}
            geocoding_success_rate = 0
            recent_properties = 0
            
            try:
                if supabase is None:
                    supabase = get_supabase_client()
                # Get property data from Supabase
                # First get properties, then get their details
                properties_result = supabase.table('properties').select('*').eq('business_id', business_id).execute()
                properties = []
                if properties_result.data:
                    for prop in properties_result.data:
                        details_result = supabase.table('property_details').select('*').eq('property_id', prop['id']).execute()
                        if details_result.data:
                            properties.extend(details_result.data)
                
                if properties:
                    # Calculate average prices
                    sold_prices = [p.get('sold_price') for p in properties if p.get('sold_price')]
                    asking_prices = [p.get('asking_price') for p in properties if p.get('asking_price')]
                    
                    property_stats['average_sold_price'] = sum(sold_prices) / len(sold_prices) if sold_prices else 0
                    property_stats['average_asking_price'] = sum(asking_prices) / len(asking_prices) if asking_prices else 0
                    
                    # Price ranges
                    price_ranges = {
                        'under_100k': len([p for p in properties if p.get('sold_price', 0) < 100000]),
                        '100k_to_250k': len([p for p in properties if 100000 <= p.get('sold_price', 0) < 250000]),
                        '250k_to_500k': len([p for p in properties if 250000 <= p.get('sold_price', 0) < 500000]),
                        '500k_to_1m': len([p for p in properties if 500000 <= p.get('sold_price', 0) < 1000000]),
                        'over_1m': len([p for p in properties if p.get('sold_price', 0) >= 1000000])
                    }
                    
                    # Property type breakdown
                    property_types = {}
                    for prop in properties:
                        prop_type = prop.get('property_type')
                        if prop_type:
                            property_types[prop_type] = property_types.get(prop_type, 0) + 1
                    property_type_counts = property_types
                    
                    # Bedroom distribution
                    bedrooms = {}
                    for prop in properties:
                        bedroom_count = prop.get('number_bedrooms')
                        if bedroom_count is not None:
                            bedrooms[str(bedroom_count)] = bedrooms.get(str(bedroom_count), 0) + 1
                    bedroom_distribution = bedrooms
                    
                    # Geocoding success rate
                    props_with_coords = len([p for p in properties if p.get('latitude') and p.get('longitude')])
                    geocoding_success_rate = (props_with_coords / len(properties) * 100) if properties else 0
                    
                    # Recent activity (last 7 days)
                    week_ago = datetime.utcnow() - timedelta(days=7)
                    recent_uploads = doc_query.filter(Document.created_at >= week_ago).count()
                    # Note: Supabase doesn't have extracted_at field, so we'll use document count as proxy
                    recent_properties = recent_uploads
                    
            except Exception as e:
                logger.warning(f"Failed to get Supabase property data: {e}")
                # Set defaults
                property_stats = {'average_sold_price': 0, 'average_asking_price': 0}
                price_ranges = {'under_100k': 0, '100k_to_250k': 0, '250k_to_500k': 0, '500k_to_1m': 0, 'over_1m': 0}
                property_type_counts = {}
                bedroom_distribution = {}
                geocoding_success_rate = 0
                recent_properties = 0
            
            analytics_data = {
                "summary": {
                    "total_documents": doc_count,
                    "total_properties": prop_count,
                    "recent_uploads_7d": recent_uploads,
                    "recent_properties_7d": recent_properties,
                    "geocoding_success_rate": round(geocoding_success_rate, 1)
                },
                "documents": {
                    "status_breakdown": status_counts,
                    "recent_uploads": [doc.serialize() for doc in recent_docs]
                },
                "properties": {
                    "price_statistics": property_stats,
                    "price_ranges": price_ranges,
                    "property_types": property_type_counts,
                    "bedroom_distribution": bedroom_distribution
                },
                "filters_applied": filters or {},
                "timestamp": datetime.utcnow().isoformat()
            }
            
            logger.info(f"AnalyticsService: Generated analytics with {doc_count} docs and {prop_count} properties")
            return analytics_data
            
        except Exception as e:
            logger.error(f"AnalyticsService: Error generating analytics: {e}")
            return {
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }

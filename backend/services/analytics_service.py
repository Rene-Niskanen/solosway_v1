from ..models import Document, ExtractedProperty, db
from datetime import datetime, timedelta
from sqlalchemy import func, desc
import logging
from typing import Dict, Any, List, Optional

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
            prop_query = ExtractedProperty.query.filter_by(business_id=business_id)
            
            if date_filter:
                doc_query = doc_query.filter(Document.created_at >= date_filter)
                prop_query = prop_query.filter(ExtractedProperty.extracted_at >= date_filter)
            
            # Basic counts
            doc_count = doc_query.count()
            prop_count = prop_query.count()
            
            # Document statistics
            recent_docs = doc_query.order_by(desc(Document.created_at)).limit(5).all()
            
            # Document status breakdown
            status_counts = {}
            for status in ['UPLOADED', 'PROCESSING', 'COMPLETED', 'FAILED']:
                status_counts[status.lower()] = doc_query.filter(
                    Document.status == status
                ).count()
            
            # Property statistics
            property_stats = {}
            
            # Average prices
            avg_sold_price = db.session.query(func.avg(ExtractedProperty.sold_price)).filter(
                ExtractedProperty.business_id == business_id,
                ExtractedProperty.sold_price.isnot(None)
            ).scalar()
            
            avg_asking_price = db.session.query(func.avg(ExtractedProperty.asking_price)).filter(
                ExtractedProperty.business_id == business_id,
                ExtractedProperty.asking_price.isnot(None)
            ).scalar()
            
            property_stats['average_sold_price'] = float(avg_sold_price) if avg_sold_price else 0
            property_stats['average_asking_price'] = float(avg_asking_price) if avg_asking_price else 0
            
            # Price ranges
            price_ranges = {
                'under_100k': prop_query.filter(ExtractedProperty.sold_price < 100000).count(),
                '100k_to_250k': prop_query.filter(
                    ExtractedProperty.sold_price >= 100000,
                    ExtractedProperty.sold_price < 250000
                ).count(),
                '250k_to_500k': prop_query.filter(
                    ExtractedProperty.sold_price >= 250000,
                    ExtractedProperty.sold_price < 500000
                ).count(),
                '500k_to_1m': prop_query.filter(
                    ExtractedProperty.sold_price >= 500000,
                    ExtractedProperty.sold_price < 1000000
                ).count(),
                'over_1m': prop_query.filter(ExtractedProperty.sold_price >= 1000000).count()
            }
            
            # Property type breakdown
            property_types = db.session.query(
                ExtractedProperty.property_type,
                func.count(ExtractedProperty.id)
            ).filter(
                ExtractedProperty.business_id == business_id,
                ExtractedProperty.property_type.isnot(None)
            ).group_by(ExtractedProperty.property_type).all()
            
            property_type_counts = {pt[0]: pt[1] for pt in property_types}
            
            # Bedroom distribution
            bedroom_counts = db.session.query(
                ExtractedProperty.number_bedrooms,
                func.count(ExtractedProperty.id)
            ).filter(
                ExtractedProperty.business_id == business_id,
                ExtractedProperty.number_bedrooms.isnot(None)
            ).group_by(ExtractedProperty.number_bedrooms).order_by(ExtractedProperty.number_bedrooms).all()
            
            bedroom_distribution = {str(bd[0]): bd[1] for bd in bedroom_counts}
            
            # Geocoding success rate
            total_props_with_coords = prop_query.filter(
                ExtractedProperty.latitude.isnot(None),
                ExtractedProperty.longitude.isnot(None)
            ).count()
            
            geocoding_success_rate = (total_props_with_coords / prop_count * 100) if prop_count > 0 else 0
            
            # Recent activity (last 7 days)
            week_ago = datetime.utcnow() - timedelta(days=7)
            recent_uploads = doc_query.filter(Document.created_at >= week_ago).count()
            recent_properties = prop_query.filter(ExtractedProperty.extracted_at >= week_ago).count()
            
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

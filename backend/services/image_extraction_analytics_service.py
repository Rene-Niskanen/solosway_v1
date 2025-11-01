"""
Image Extraction Analytics Service
Tracks performance metrics and analytics for image extraction processes
"""

import os
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from supabase import create_client

class ImageExtractionAnalyticsService:
    """Service for tracking image extraction performance and analytics"""
    
    def __init__(self):
        self.supabase = create_client(
            os.environ['SUPABASE_URL'],
            os.environ['SUPABASE_SERVICE_KEY']
        )
    
    def log_extraction_metrics(
        self,
        document_id: str,
        business_id: str,
        extraction_stats: Dict,
        processing_time: float,
        success: bool
    ) -> bool:
        """Log image extraction metrics"""
        try:
            metrics_data = {
                'document_id': document_id,
                'business_id': business_id,
                'extraction_stats': extraction_stats,
                'processing_time_seconds': processing_time,
                'success': success,
                'timestamp': datetime.utcnow().isoformat(),
                'total_images_found': extraction_stats.get('total_images_found', 0),
                'property_images_classified': extraction_stats.get('classification_stats', {}).get('total_classified', 0),
                'successful_uploads': extraction_stats.get('classification_stats', {}).get('successful_uploads', 0),
                'failed_uploads': extraction_stats.get('classification_stats', {}).get('failed_uploads', 0),
                'extraction_method': 'llamaparse_enhanced'
            }
            
            # Store in Supabase
            result = self.supabase.table('image_extraction_analytics').insert(metrics_data).execute()
            
            return len(result.data) > 0
            
        except Exception as e:
            print(f"Error logging extraction metrics: {e}")
            return False
    
    def get_extraction_statistics(self, business_id: str, days: int = 30) -> Dict:
        """Get image extraction statistics for a business"""
        try:
            start_date = datetime.utcnow() - timedelta(days=days)
            
            # Query analytics data
            result = self.supabase.table('image_extraction_analytics')\
                .select('*')\
                .eq('business_id', business_id)\
                .gte('timestamp', start_date.isoformat())\
                .execute()
            
            analytics_data = result.data
            
            if not analytics_data:
                return self._empty_statistics()
            
            # Calculate statistics
            total_documents = len(analytics_data)
            successful_extractions = sum(1 for item in analytics_data if item['success'])
            total_images_found = sum(item['total_images_found'] for item in analytics_data)
            total_property_images = sum(item['property_images_classified'] for item in analytics_data)
            total_uploads = sum(item['successful_uploads'] for item in analytics_data)
            total_failed_uploads = sum(item['failed_uploads'] for item in analytics_data)
            avg_processing_time = sum(item['processing_time_seconds'] for item in analytics_data) / total_documents
            
            # Calculate success rates
            extraction_success_rate = (successful_extractions / total_documents) * 100 if total_documents > 0 else 0
            classification_rate = (total_property_images / total_images_found) * 100 if total_images_found > 0 else 0
            upload_success_rate = (total_uploads / (total_uploads + total_failed_uploads)) * 100 if (total_uploads + total_failed_uploads) > 0 else 0
            
            return {
                'period_days': days,
                'total_documents_processed': total_documents,
                'successful_extractions': successful_extractions,
                'extraction_success_rate': round(extraction_success_rate, 2),
                'total_images_found': total_images_found,
                'total_property_images_classified': total_property_images,
                'classification_rate': round(classification_rate, 2),
                'total_uploads_successful': total_uploads,
                'total_uploads_failed': total_failed_uploads,
                'upload_success_rate': round(upload_success_rate, 2),
                'average_processing_time_seconds': round(avg_processing_time, 2),
                'images_per_document_avg': round(total_images_found / total_documents, 2) if total_documents > 0 else 0,
                'property_images_per_document_avg': round(total_property_images / total_documents, 2) if total_documents > 0 else 0
            }
            
        except Exception as e:
            print(f"Error getting extraction statistics: {e}")
            return self._empty_statistics()
    
    def get_daily_metrics(self, business_id: str, days: int = 7) -> List[Dict]:
        """Get daily metrics for the last N days"""
        try:
            daily_metrics = []
            
            for i in range(days):
                date = datetime.utcnow() - timedelta(days=i)
                start_of_day = date.replace(hour=0, minute=0, second=0, microsecond=0)
                end_of_day = start_of_day + timedelta(days=1)
                
                # Query data for this day
                result = self.supabase.table('image_extraction_analytics')\
                    .select('*')\
                    .eq('business_id', business_id)\
                    .gte('timestamp', start_of_day.isoformat())\
                    .lt('timestamp', end_of_day.isoformat())\
                    .execute()
                
                day_data = result.data
                
                if day_data:
                    total_docs = len(day_data)
                    successful = sum(1 for item in day_data if item['success'])
                    total_images = sum(item['total_images_found'] for item in day_data)
                    property_images = sum(item['property_images_classified'] for item in day_data)
                    uploads = sum(item['successful_uploads'] for item in day_data)
                    avg_time = sum(item['processing_time_seconds'] for item in day_data) / total_docs
                else:
                    total_docs = successful = total_images = property_images = uploads = avg_time = 0
                
                daily_metrics.append({
                    'date': start_of_day.strftime('%Y-%m-%d'),
                    'documents_processed': total_docs,
                    'successful_extractions': successful,
                    'total_images_found': total_images,
                    'property_images_classified': property_images,
                    'successful_uploads': uploads,
                    'average_processing_time': round(avg_time, 2)
                })
            
            return daily_metrics
            
        except Exception as e:
            print(f"Error getting daily metrics: {e}")
            return []
    
    def get_performance_insights(self, business_id: str, days: int = 30) -> Dict:
        """Get performance insights and recommendations"""
        try:
            stats = self.get_extraction_statistics(business_id, days)
            
            insights = []
            recommendations = []
            
            # Analyze extraction success rate
            if stats['extraction_success_rate'] < 90:
                insights.append(f"Extraction success rate is {stats['extraction_success_rate']}%, below optimal threshold")
                recommendations.append("Consider reviewing document quality and format compatibility")
            
            # Analyze classification rate
            if stats['classification_rate'] < 70:
                insights.append(f"Only {stats['classification_rate']}% of images are classified as property photos")
                recommendations.append("Review image classification criteria and adjust thresholds")
            
            # Analyze upload success rate
            if stats['upload_success_rate'] < 95:
                insights.append(f"Upload success rate is {stats['upload_success_rate']}%, indicating storage issues")
                recommendations.append("Check storage service configuration and network connectivity")
            
            # Analyze processing time
            if stats['average_processing_time_seconds'] > 60:
                insights.append(f"Average processing time is {stats['average_processing_time_seconds']}s, which is slow")
                recommendations.append("Consider optimizing image processing pipeline or increasing resources")
            
            # Analyze image yield
            if stats['images_per_document_avg'] < 2:
                insights.append(f"Low image yield: only {stats['images_per_document_avg']} images per document on average")
                recommendations.append("Review document types and consider adjusting extraction parameters")
            
            return {
                'insights': insights,
                'recommendations': recommendations,
                'performance_score': self._calculate_performance_score(stats),
                'last_updated': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            print(f"Error getting performance insights: {e}")
            return {
                'insights': [],
                'recommendations': [],
                'performance_score': 0,
                'last_updated': datetime.utcnow().isoformat()
            }
    
    def _calculate_performance_score(self, stats: Dict) -> int:
        """Calculate overall performance score (0-100)"""
        try:
            score = 0
            
            # Extraction success rate (30 points)
            score += min(stats['extraction_success_rate'] * 0.3, 30)
            
            # Classification rate (25 points)
            score += min(stats['classification_rate'] * 0.25, 25)
            
            # Upload success rate (25 points)
            score += min(stats['upload_success_rate'] * 0.25, 25)
            
            # Processing time (20 points) - faster is better
            if stats['average_processing_time_seconds'] <= 30:
                score += 20
            elif stats['average_processing_time_seconds'] <= 60:
                score += 15
            elif stats['average_processing_time_seconds'] <= 120:
                score += 10
            else:
                score += 5
            
            return min(int(score), 100)
            
        except Exception as e:
            print(f"Error calculating performance score: {e}")
            return 0
    
    def _empty_statistics(self) -> Dict:
        """Return empty statistics structure"""
        return {
            'period_days': 0,
            'total_documents_processed': 0,
            'successful_extractions': 0,
            'extraction_success_rate': 0,
            'total_images_found': 0,
            'total_property_images_classified': 0,
            'classification_rate': 0,
            'total_uploads_successful': 0,
            'total_uploads_failed': 0,
            'upload_success_rate': 0,
            'average_processing_time_seconds': 0,
            'images_per_document_avg': 0,
            'property_images_per_document_avg': 0
        }
